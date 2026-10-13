import pg from 'pg';
// SQL DATE is a calendar date, not local midnight converted to a UTC timestamp.
pg.types.setTypeParser(1082, value => value);
import { workingHoursError } from './language.js';
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
  await pool.query(`CREATE TABLE IF NOT EXISTS task_notifications (
    id SERIAL PRIMARY KEY, recipient_id INTEGER NOT NULL REFERENCES employees(id),
    actor_id INTEGER NOT NULL REFERENCES employees(id), task_id INTEGER NOT NULL REFERENCES tasks(id),
    read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (recipient_id,task_id)
  )`);
  await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ');
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY, actor_id INTEGER REFERENCES employees(id),
    action TEXT NOT NULL, details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const row of employees) {
    await pool.query('INSERT INTO employees (id,name,department,role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', row);
  }
  await pool.query('CREATE INDEX IF NOT EXISTS tasks_assignee_due ON tasks (assignee_id, due_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_bindings (
    telegram_id BIGINT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
    identity_mode TEXT NOT NULL DEFAULT 'secure_link',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query("ALTER TABLE telegram_bindings ADD COLUMN IF NOT EXISTS identity_mode TEXT NOT NULL DEFAULT 'secure_link'");
  await pool.query('ALTER TABLE telegram_bindings DROP CONSTRAINT IF EXISTS telegram_bindings_employee_id_key');
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code_hash TEXT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS employee_requests (
    id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
    approver_id INTEGER REFERENCES employees(id), request_type TEXT NOT NULL
      CHECK (request_type IN ('annual_leave','sick_leave','remote_work','expense')),
    request_date DATE, amount NUMERIC(14,2), description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, report_deadline DATE, report_file_id TEXT,
    decided_at TIMESTAMPTZ, report_received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS end_date DATE');
  await pool.query('ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS monitor_id INTEGER REFERENCES employees(id)');
  await pool.query('CREATE INDEX IF NOT EXISTS requests_approver_status ON employee_requests (approver_id,status)');
  await pool.query('CREATE INDEX IF NOT EXISTS requests_employee_date ON employee_requests (employee_id,request_date)');
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_conversations (
    telegram_id BIGINT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
    messages JSONB NOT NULL DEFAULT '[]'
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_access (
    telegram_id BIGINT NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id),
    PRIMARY KEY (telegram_id,employee_id)
  )`);
  // Migrate only previously verified links, never demo identity choices.
  await pool.query(`INSERT INTO telegram_access (telegram_id,employee_id)
    SELECT telegram_id,employee_id FROM telegram_bindings WHERE identity_mode='secure_link'
    ON CONFLICT (telegram_id,employee_id) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_sessions (
    telegram_id BIGINT PRIMARY KEY, active_user_id INTEGER REFERENCES employees(id),
    awaiting_id BOOLEAN NOT NULL DEFAULT true, revision TEXT NOT NULL,
    current_action TEXT, expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id BIGINT PRIMARY KEY, reply TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query("ALTER TABLE telegram_updates ADD COLUMN IF NOT EXISTS menu JSONB");
  await pool.query("ALTER TABLE telegram_updates ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'clarification'");
}

export function canAccess(actor, target) {
  return actor.role === 'manager' || actor.id === target.id ||
    (actor.role === 'supervisor' && actor.department === target.department);
}

export class Store {
  constructor(pool, transactional = false) { this.pool = pool; this.transactional = transactional; }
  async user(id) {
    return (await this.pool.query('SELECT * FROM employees WHERE id=$1', [id])).rows[0];
  }
  async users() { return (await this.pool.query('SELECT * FROM employees ORDER BY id')).rows; }
  async audit(actorId, action, details) {
    await this.pool.query('INSERT INTO audit_log (actor_id,action,details) VALUES ($1,$2,$3)', [actorId, action, JSON.stringify(details)]);
  }
  // Re-read identities inside the repository: callers cannot supply a forged role.
  async create(actorId, targetId, description, dueAt) {
    const client = this.transactional ? this.pool : await this.pool.connect();
    try {
      if (!this.transactional) await client.query('BEGIN');
      const actor = (await client.query('SELECT * FROM employees WHERE id=$1 FOR SHARE', [actorId])).rows[0];
      const target = (await client.query('SELECT * FROM employees WHERE id=$1 FOR SHARE', [targetId])).rows[0];
      if (!actor || !target || !canAccess(actor, target)) throw new Error('FORBIDDEN');
      if (workingHoursError(dueAt)) throw new Error('OUTSIDE_WORKING_HOURS');
      const task = (await client.query(`INSERT INTO tasks (assignee_id,created_by,description,due_at)
        VALUES ($1,$2,$3,$4) RETURNING *`, [target.id, actor.id, description, dueAt])).rows[0];
      await client.query('INSERT INTO audit_log (actor_id,action,details) VALUES ($1,$2,$3)',
        [actor.id, 'create_task', JSON.stringify({ task_id: task.id, assignee_id: target.id })]);
      if(actor.id!==target.id&&['manager','supervisor'].includes(actor.role)) {
        await client.query('INSERT INTO task_notifications (recipient_id,actor_id,task_id) VALUES ($1,$2,$3)',[target.id,actor.id,task.id]);
      }
      if (!this.transactional) await client.query('COMMIT');
      return task;
    } catch (error) { if (!this.transactional) await client.query('ROLLBACK'); throw error; }
    finally { if (!this.transactional) client.release(); }
  }
  async auditEntries(actorId) {
    const actor=await this.user(actorId);
    if(!actor||actor.role==='employee') throw new Error('FORBIDDEN');
    const select=`SELECT a.*,e.name AS actor_name FROM audit_log a
      LEFT JOIN employees e ON e.id=a.actor_id`;
    if(actor.role==='manager') return (await this.pool.query(select+' ORDER BY a.id DESC LIMIT 100')).rows;
    return (await this.pool.query(select+`
      LEFT JOIN tasks t ON t.id::text=a.details->>'task_id'
      LEFT JOIN employees te ON te.id=t.assignee_id
      LEFT JOIN employee_requests r ON r.id::text=a.details->>'request_id'
      LEFT JOIN employees re ON re.id=r.employee_id
      WHERE e.department=$1 OR te.department=$1 OR re.department=$1
      ORDER BY a.id DESC LIMIT 100`,[actor.department])).rows;
  }
  async consumeNotifications(actorId) {
    const rows=(await this.pool.query(`SELECT n.id,n.task_id,e.name AS actor_name,e.role AS actor_role,t.description
      FROM task_notifications n JOIN employees e ON e.id=n.actor_id JOIN tasks t ON t.id=n.task_id
      WHERE n.recipient_id=$1 AND n.read_at IS NULL ORDER BY n.id`,[actorId])).rows;
    const notices=[];
    for(const row of rows) {
      const changed=(await this.pool.query('UPDATE task_notifications SET read_at=CURRENT_TIMESTAMP WHERE id=$1 AND recipient_id=$2 AND read_at IS NULL RETURNING id',[row.id,actorId])).rows.length;
      if(changed) notices.push(row);
    }
    return notices;
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
