import express from 'express';

function boundaries() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const week = new Date(today);
  const day = week.getDay() || 7;
  week.setDate(week.getDate() - day + 1);
  return { today: today.toISOString(), week: week.toISOString() };
}

export function dashboardRouter({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/stats', (req, res) => {
    const { today, week } = boundaries();
    const publicTotal = db.prepare('SELECT count(*) total FROM customers WHERE owner_id IS NULL AND deleted_at IS NULL').get().total;
    if (req.user.role === 'sales') {
      const todayNew = db.prepare('SELECT count(*) total FROM customers WHERE created_by = ? AND created_at >= ? AND deleted_at IS NULL').get(req.user.id, today).total;
      const privateTotal = db.prepare('SELECT count(*) total FROM customers WHERE owner_id = ? AND deleted_at IS NULL').get(req.user.id).total;
      const weeklyFollowUps = db.prepare('SELECT count(*) total FROM follow_ups WHERE author_id = ? AND followed_at >= ?').get(req.user.id, week).total;
      const recent = db.prepare(`SELECT f.id, f.followed_at, f.content, c.id customer_id, c.company_name
        FROM follow_ups f JOIN customers c ON c.id = f.customer_id
        WHERE f.author_id = ? ORDER BY f.followed_at DESC LIMIT 5`).all(req.user.id);
      return res.json({ data: { view: 'sales', todayNew, privateTotal, publicTotal, weeklyFollowUps, recent } });
    }
    const todayNew = db.prepare('SELECT count(*) total FROM customers WHERE created_at >= ? AND deleted_at IS NULL').get(today).total;
    const privateTotal = db.prepare('SELECT count(*) total FROM customers WHERE owner_id IS NOT NULL AND deleted_at IS NULL').get().total;
    const weeklyFollowUps = db.prepare('SELECT count(*) total FROM follow_ups WHERE followed_at >= ?').get(week).total;
    const recent = db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT 5').all().map(row => ({ ...row, details: JSON.parse(row.details || '{}') }));
    return res.json({ data: { view: 'admin', todayNew, privateTotal, publicTotal, weeklyFollowUps, recent } });
  });
  return router;
}
