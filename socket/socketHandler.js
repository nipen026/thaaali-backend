const setupSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);
    socket.on('join_role', (role) => { socket.join(role); console.log(`${socket.id} joined room: ${role}`); });
    socket.on('order_status_change', (data) => { io.emit('order_updated', data); });
    socket.on('table_call', (data) => { io.emit('waiter_called', data); });
    socket.on('disconnect', () => console.log(`❌ Client disconnected: ${socket.id}`));
  });
};
module.exports = { setupSocket };
