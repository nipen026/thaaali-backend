const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeMenuCategory, serializeMenuItem } = require('../utils/serialize');

router.get('/', async (req, res, next) => {
  try {
    const { type, spice, dietary, category, available, search } = req.query;
    const where = { tenantId: req.tenantId };
    if (type) where.type = type;
    if (spice) where.spice = spice;
    if (dietary) where.dietary = { has: dietary };
    if (category) where.categoryId = category;
    if (available === 'true') where.available = true;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [categories, items] = await Promise.all([
      prisma.menuCategory.findMany({ where: { tenantId: req.tenantId }, orderBy: { sort: 'asc' } }),
      prisma.menuItem.findMany({ where, orderBy: { name: 'asc' } }),
    ]);
    res.json({ categories: categories.map(serializeMenuCategory), items: items.map(serializeMenuItem) });
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { name, icon, sort } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const count = await prisma.menuCategory.count({ where: { tenantId: req.tenantId } });
    const category = await prisma.menuCategory.create({
      data: { tenantId: req.tenantId, name, icon: icon || null, sort: sort ?? count },
    });
    res.status(201).json(serializeMenuCategory(category));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = {};
    const { category, name, price, type, spice, dietary, available, calories, description, image } = req.body;
    if (category !== undefined) data.categoryId = category;
    if (name !== undefined) data.name = name;
    if (price !== undefined) data.price = price;
    if (type !== undefined) data.type = type;
    if (spice !== undefined) data.spice = spice;
    if (dietary !== undefined) data.dietary = dietary;
    if (available !== undefined) data.available = available;
    if (calories !== undefined) data.calories = calories;
    if (description !== undefined) data.description = description;
    if (image !== undefined) data.image = image;

    const item = await prisma.menuItem.update({ where: { id: req.params.id }, data });
    const out = serializeMenuItem(item);
    req.io.emit('menu_updated', out);
    res.json(out);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { category, name, price, type, spice, dietary, available, calories, description, image } = req.body;
    const item = await prisma.menuItem.create({
      data: {
        tenantId: req.tenantId,
        categoryId: category,
        name, price, type,
        spice: spice || 'mild',
        dietary: dietary || [],
        available: available !== undefined ? available : true,
        calories, description, image,
      },
    });
    const out = serializeMenuItem(item);
    req.io.emit('menu_updated', out);
    res.status(201).json(out);
  } catch (err) { next(err); }
});

module.exports = router;
