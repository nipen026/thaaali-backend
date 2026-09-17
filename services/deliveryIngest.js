const { prisma } = require('../config/prisma');
const { serializeOrder } = require('../utils/serialize');

class IngestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Shared by the public webhook route (routes/webhooks.js) and the authenticated
// "simulate incoming order" dev tool (routes/integrations.js) so both go through
// identical idempotency + item-mapping behavior.
//
// `payload` is the normalized shape any platform/aggregator adapter must produce:
//   { external_order_id, customer_name?, customer_phone?, items: [{ external_item_id, name, price, qty }] }
async function ingestDeliveryOrder({ integration, payload, io }) {
  const { external_order_id, customer_name, customer_phone, items } = payload || {};
  if (!external_order_id) throw new IngestError(400, 'external_order_id is required');
  if (!Array.isArray(items) || items.length === 0) throw new IngestError(400, 'items must be a non-empty array');
  for (const i of items) {
    if (!i.external_item_id || !i.name || i.price == null || i.qty == null) {
      throw new IngestError(400, 'each item needs external_item_id, name, price, and qty');
    }
  }

  const tenantId = integration.tenantId;
  const channel = integration.platform;

  const existing = await prisma.order.findUnique({
    where: { tenantId_channel_externalOrderId: { tenantId, channel, externalOrderId: String(external_order_id) } },
    include: { items: true, table: true },
  });
  if (existing) return { order: existing, created: false };

  const extIds = [...new Set(items.map((i) => String(i.external_item_id)))];
  const mappings = await prisma.externalMenuMapping.findMany({
    where: { integrationId: integration.id, externalItemId: { in: extIds } },
  });
  const mappingByExtId = new Map(mappings.map((m) => [m.externalItemId, m]));

  // First time we've seen one of these external item ids — record it as "needs mapping"
  // (menuItemId stays null) so it surfaces in the integration settings UI. A manager
  // mapping it there is what makes *future* orders resolve to a real MenuItem.
  const unseen = extIds.filter((id) => !mappingByExtId.has(id));
  if (unseen.length) {
    await prisma.$transaction(
      unseen.map((extId) => {
        const item = items.find((i) => String(i.external_item_id) === extId);
        return prisma.externalMenuMapping.upsert({
          where: { integrationId_externalItemId: { integrationId: integration.id, externalItemId: extId } },
          create: { integrationId: integration.id, externalItemId: extId, externalName: item.name },
          update: {},
        });
      })
    );
  }

  const total = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);

  const order = await prisma.order.create({
    data: {
      tenantId,
      channel,
      externalOrderId: String(external_order_id),
      total,
      customerName: customer_name || null,
      customerPhone: customer_phone || null,
      items: {
        create: items.map((i) => ({
          menuItemId: mappingByExtId.get(String(i.external_item_id))?.menuItemId || null,
          nameSnapshot: i.name,
          priceSnapshot: i.price,
          qty: i.qty,
          unit: 'item',
        })),
      },
    },
    include: { items: true, table: true },
  });

  await prisma.deliveryIntegration.update({ where: { id: integration.id }, data: { lastOrderAt: new Date() } });

  // Same "latest wins" contact upsert as the manual order-creation path in routes/orders.js.
  if (customer_phone) {
    await prisma.customer.upsert({
      where: { tenantId_phone: { tenantId, phone: customer_phone } },
      create: { tenantId, name: customer_name || 'Guest', phone: customer_phone, ordersCount: 1, lastOrderAt: new Date() },
      update: { name: customer_name || undefined, ordersCount: { increment: 1 }, lastOrderAt: new Date() },
    });
  }

  const out = serializeOrder(order);
  io.emit('new_order', out);

  return { order, created: true };
}

module.exports = { ingestDeliveryOrder, IngestError };
