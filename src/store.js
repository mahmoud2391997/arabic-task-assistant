export const employees = [
  [1, 'منيرة', 'الإدارة', 'manager'], [2, 'سارة', 'المشاريع', 'supervisor'],
  [3, 'فهد', 'المشاريع', 'employee'], [4, 'خالد', 'المشاريع', 'employee'],
  [5, 'نورة', 'المالية', 'employee'], [6, 'عبدالرحمن', 'المالية', 'supervisor'],
];

export async function initialize(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('manager','supervisor','employee'))
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY, assignee_id INTEGER NOT NULL REFERENCES employees(id),
    created_by INTEGER NOT NULL REFERENCES employees(id), description TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY, actor_id INTEGER REFERENCES employees(id),
    action TEXT NOT NULL, details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const row of employees) {
    await pool.query('INSERT INTO employees (id,name,department,role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', row);
  }
  await pool.query('CREATE INDEX IF NOT EXISTS tasks_assignee_due ON tasks (assignee_id, due_at)');
}

export function canAccess(actor, target) {
  return actor.role === 'manager' || actor.id === target.id ||
    (actor.role === 'supervisor' && actor.department === target.department);
}

export class Store {
  constructor(pool) { this.pool = pool; }
  async user(id) {
    return (await this.pool.query('SELECT * FROM employees WHERE id=$1', [id])).rows[0];
  }
  async users() { return (await this.pool.query('SELECT * FROM employees ORDER BY id')).rows; }
  async audit(actorId, action, details) {
    await this.pool.query('INSERT INTO audit_log (actor_id,action,details) VALUES ($1,$2,$3)', [actorId, action, JSON.stringify(details)]);
  }
  // Re-read identities inside the repository: callers cannot supply a forged role.
  async create(actorId, targetId, description, dueAt) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = (await client.query('SELECT * FROM employees WHERE id=$1 FOR SHARE', [actorId])).rows[0];
      const target = (await client.query('SELECT * FROM employees WHERE id=$1 FOR SHARE', [targetId])).rows[0];
      if (!actor || !target || !canAccess(actor, target)) throw new Error('FORBIDDEN');
      const task = (await client.query(`INSERT INTO tasks (assignee_id,created_by,description,due_at)
        VALUES ($1,$2,$3,$4) RETURNING *`, [target.id, actor.id, description, dueAt])).rows[0];
      await client.query('INSERT INTO audit_log (actor_id,action,details) VALUES ($1,$2,$3)',
        [actor.id, 'create_task', JSON.stringify({ task_id: task.id, assignee_id: target.id })]);
      await client.query('COMMIT');
      return task;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async list(actorId, targetId, all = false, departmentOnly = false) {
    const actor = await this.user(actorId);
    if (!actor) throw new Error('FORBIDDEN');
    if (all) {
      if (actor.role === 'manager' && !departmentOnly) return (await this.pool.query('SELECT * FROM tasks ORDER BY due_at,id')).rows;
      if (actor.role === 'employee') throw new Error('FORBIDDEN');
      return (await this.pool.query(`SELECT t.* FROM tasks t JOIN employees e ON e.id=t.assignee_id
        WHERE e.department=$1 ORDER BY t.due_at,t.id`, [actor.department])).rows;
    }
    const target = await this.user(targetId ?? actorId);
    if (!target || !canAccess(actor, target)) throw new Error('FORBIDDEN');
    // Scope is part of the SQL query, never a filter on data returned to the model.
    return (await this.pool.query('SELECT * FROM tasks WHERE assignee_id=$1 ORDER BY due_at,id', [target.id])).rows;
  }
}
