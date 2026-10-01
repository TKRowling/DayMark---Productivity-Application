import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  Award,
  Beef,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Cloud,
  CloudOff,
  Dumbbell,
  Edit3,
  FileText,
  Flame,
  HeartPulse,
  Home,
  LayoutList,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  Trophy,
  Utensils,
  X,
} from 'lucide-react'

const STORAGE_KEY = 'daymark-dashboard-v1'
const WORKSPACE_KEY = 'daymark-workspace-id'
const SHARED_WORKSPACE_ID = 'tkrowling-dashboard'

const localISO = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

const addDays = (amount) => {
  const date = new Date()
  date.setDate(date.getDate() + amount)
  return localISO(date)
}

const seedData = () => ({
  tasks: [
    { id: crypto.randomUUID(), title: '30-minute morning walk', time: '7:30 AM', category: 'Wellness', date: localISO(), completed: true },
    { id: crypto.randomUUID(), title: 'Review scholarship essay', time: '10:00 AM', category: 'Scholarship', date: localISO(), completed: false },
    { id: crypto.randomUUID(), title: 'Complete reading assignment', time: '2:00 PM', category: 'Study', date: localISO(), completed: false },
    { id: crypto.randomUUID(), title: 'Upper body workout', time: '6:30 PM', category: 'Fitness', date: localISO(), completed: false },
    { id: crypto.randomUUID(), title: 'Plan tomorrow’s priorities', time: '9:00 PM', category: 'Personal', date: localISO(), completed: false },
  ],
  scholarship: {
    name: 'Global Future Leaders Scholarship',
    provider: 'Bright Horizons Foundation',
    amount: '$10,000',
    deadline: addDays(19),
    notes: 'For students demonstrating academic excellence, leadership, and a commitment to community impact.',
    requirements: [
      { id: crypto.randomUUID(), title: 'Personal statement', done: true },
      { id: crypto.randomUUID(), title: 'Academic transcript', done: true },
      { id: crypto.randomUUID(), title: 'Two recommendation letters', done: false },
      { id: crypto.randomUUID(), title: 'Financial information form', done: false },
      { id: crypto.randomUUID(), title: 'Final application review', done: false },
    ],
  },
  weights: [
    { id: crypto.randomUUID(), date: addDays(-35), value: 82.4 },
    { id: crypto.randomUUID(), date: addDays(-28), value: 81.8 },
    { id: crypto.randomUUID(), date: addDays(-21), value: 81.2 },
    { id: crypto.randomUUID(), date: addDays(-14), value: 80.8 },
    { id: crypto.randomUUID(), date: addDays(-7), value: 80.1 },
    { id: crypto.randomUUID(), date: localISO(), value: 79.6 },
  ],
  workouts: [
    { id: crypto.randomUUID(), day: 'MON', title: 'Upper body', detail: 'Chest, shoulders & triceps', time: '6:30 PM', done: true },
    { id: crypto.randomUUID(), day: 'WED', title: 'Lower body', detail: 'Glutes, quads & hamstrings', time: '6:30 PM', done: false },
    { id: crypto.randomUUID(), day: 'FRI', title: 'Full body', detail: 'Compound movements', time: '5:30 PM', done: false },
    { id: crypto.randomUUID(), day: 'SUN', title: 'Active recovery', detail: 'Yoga & light stretching', time: '9:00 AM', done: false },
  ],
  meals: [
    { id: crypto.randomUUID(), type: 'Breakfast', title: 'Greek yogurt bowl', detail: 'Berries, oats & honey', calories: 410 },
    { id: crypto.randomUUID(), type: 'Lunch', title: 'Chicken grain bowl', detail: 'Brown rice, greens & avocado', calories: 620 },
    { id: crypto.randomUUID(), type: 'Dinner', title: 'Salmon & vegetables', detail: 'Roasted potatoes & broccoli', calories: 680 },
    { id: crypto.randomUUID(), type: 'Snack', title: 'Apple & almond butter', detail: 'Simple afternoon fuel', calories: 210 },
  ],
})

function getWorkspaceId() {
  // Daymark is currently a single-user workspace. A stable ID lets the same
  // dashboard sync across TKRowling's phone and laptop instead of creating a
  // separate backend record for every browser.
  localStorage.setItem(WORKSPACE_KEY, SHARED_WORKSPACE_ID)
  return SHARED_WORKSPACE_ID
}

function useDashboardData() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : seedData()
    } catch {
      return seedData()
    }
  })
  const [apiStatus, setApiStatus] = useState('connecting')
  const [retryToken, setRetryToken] = useState(0)
  const isHydrated = useRef(false)
  const workspaceId = useRef(getWorkspaceId())

  useEffect(() => {
    const controller = new AbortController()

    const connect = async () => {
      setApiStatus('connecting')
      try {
        let response = await fetch('/api/dashboard', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Workspace-ID': workspaceId.current,
          },
          signal: controller.signal,
        })

        // A brand-new shared workspace starts with this device's local copy.
        // Existing workspaces always remain server-first to prevent stale data
        // from another browser overwriting newer activities.
        if (response.status === 404) {
          response = await fetch('/api/dashboard', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Workspace-ID': workspaceId.current,
            },
            body: JSON.stringify(data),
            signal: controller.signal,
          })
        }

        if (!response.ok) throw new Error(`API responded with ${response.status}`)
        const { synced_at: _syncedAt, ...dashboard } = await response.json()
        setData(dashboard)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboard))
        isHydrated.current = true
        setApiStatus('synced')
      } catch (error) {
        if (error.name !== 'AbortError') {
          isHydrated.current = false
          setApiStatus('offline')
        }
      }
    }

    connect()
    return () => controller.abort()
    // retryToken intentionally controls explicit reconnection attempts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

    if (!isHydrated.current) return undefined
    setApiStatus('saving')
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/dashboard', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Workspace-ID': workspaceId.current,
          },
          body: JSON.stringify(data),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`API responded with ${response.status}`)
        setApiStatus('synced')
      } catch (error) {
        if (error.name !== 'AbortError') {
          isHydrated.current = false
          setApiStatus('offline')
        }
      }
    }, 550)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [data])

  const retry = () => {
    setRetryToken((value) => value + 1)
  }

  return [data, setData, apiStatus, retry]
}

const formatDate = (value, options = {}) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...options }).format(new Date(`${value}T12:00:00`))

const daysUntil = (value) => Math.max(0, Math.ceil((new Date(`${value}T23:59:59`) - new Date()) / 86_400_000))

const categoryClass = (category) => category.toLowerCase().replaceAll(' ', '-')

function Sidebar({ page, setPage, open, setOpen }) {
  const nav = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'daily', label: 'Daily activities', icon: LayoutList },
    { id: 'scholarship', label: 'Scholarship', icon: Award },
    { id: 'weight', label: 'Weight loss', icon: Scale },
    { id: 'wellness', label: 'Gym & meals', icon: Dumbbell },
  ]

  const navigate = (id) => {
    setPage(id)
    setOpen(false)
  }

  return (
    <>
      <button className={`sidebar-shade ${open ? 'visible' : ''}`} onClick={() => setOpen(false)} aria-label="Close menu" />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate('overview')}>
          <span className="brand-mark"><Check size={20} strokeWidth={3} /></span>
          <span>daymark<span className="brand-dot">.</span></span>
        </button>

        <div className="sidebar-block">
          <p className="sidebar-label">Workspace</p>
          <nav>
            {nav.slice(0, 1).map(({ id, label, icon: Icon }) => (
              <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}>
                <Icon size={19} /> <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-block goals-block">
          <p className="sidebar-label">My goals</p>
          <nav>
            {nav.slice(1).map(({ id, label, icon: Icon }) => (
              <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}>
                <Icon size={19} /> <span>{label}</span>
                {id === 'scholarship' && <span className="nav-badge">2</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-quote">
          <div className="quote-icon"><Sparkles size={17} /></div>
          <p>Small steps, every day.</p>
          <span>You’re building something great.</span>
        </div>

        <div className="profile-card">
          <div className="avatar">TK</div>
          <div><strong>TKRowling</strong><span>Personal workspace</span></div>
          <MoreHorizontal size={18} />
        </div>
      </aside>
    </>
  )
}

function Topbar({ title, onMenu, apiStatus, onRetry }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const prettyDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  return (
    <header className="topbar">
      <button className="mobile-menu icon-button" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
      <div className="topbar-heading"><span>{title}</span><small>{prettyDate}</small></div>
      <div className="topbar-actions">
        <button className={`sync-status ${apiStatus}`} onClick={apiStatus === 'offline' ? onRetry : undefined} title={apiStatus === 'offline' ? 'Backend unavailable — click to retry' : 'FastAPI sync status'}>
          {apiStatus === 'offline' ? <CloudOff size={15} /> : apiStatus === 'connecting' || apiStatus === 'saving' ? <RefreshCw size={15} /> : <Cloud size={15} />}
          <span>{apiStatus === 'offline' ? 'Local mode' : apiStatus === 'saving' ? 'Saving' : apiStatus === 'connecting' ? 'Connecting' : 'Synced'}</span>
        </button>
        <div className={`search ${searchOpen ? 'expanded' : ''}`}>
          <Search size={18} />
          <input placeholder="Search your goals..." aria-label="Search" onFocus={() => setSearchOpen(true)} onBlur={() => setSearchOpen(false)} />
        </div>
        <button className="icon-button notification" aria-label="Notifications"><Bell size={19} /><i /></button>
      </div>
    </header>
  )
}

function ProgressRing({ value, size = 76 }) {
  return (
    <div className="progress-ring" style={{ '--progress': `${value * 3.6}deg`, width: size, height: size }}>
      <div><strong>{value}%</strong><span>done</span></div>
    </div>
  )
}

function Overview({ data, setData, setPage }) {
  const todayTasks = data.tasks.filter((task) => task.date === localISO())
  const completed = todayTasks.filter((task) => task.completed).length
  const completion = todayTasks.length ? Math.round((completed / todayTasks.length) * 100) : 0
  const requirementsDone = data.scholarship.requirements.filter((item) => item.done).length
  const scholarshipProgress = Math.round((requirementsDone / data.scholarship.requirements.length) * 100)
  const latest = data.weights.at(-1)?.value || 0
  const start = data.weights.at(0)?.value || latest
  const change = (latest - start).toFixed(1)

  const toggleTask = (id) => setData((current) => ({
    ...current,
    tasks: current.tasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task),
  }))

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow"><span /> YOUR DAY AT A GLANCE</p>
          <h1>Good morning, TKRowling.</h1>
          <p>Here’s what’s happening today. Keep the momentum going.</p>
        </div>
        <div className="daily-score"><ProgressRing value={completion} /><div><span>Daily progress</span><strong>{completed} of {todayTasks.length} tasks</strong><small>{todayTasks.length - completed} left to complete</small></div></div>
      </section>

      <section className="overview-grid">
        <div className="card tasks-card">
          <div className="card-head">
            <div><span className="card-kicker">TODAY</span><h2>Daily activities</h2></div>
            <button className="text-button" onClick={() => setPage('daily')}>View all <ArrowRight size={15} /></button>
          </div>
          <div className="task-list compact">
            {todayTasks.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} onToggle={toggleTask} />)}
          </div>
          <button className="add-row" onClick={() => setPage('daily')}><Plus size={17} /> Add a new task</button>
        </div>

        <div className="right-stack">
          <button className="card goal-card scholarship-card" onClick={() => setPage('scholarship')}>
            <div className="goal-card-top"><span className="goal-icon coral"><Award size={19} /></span><span className="deadline-pill"><Clock3 size={13} /> {daysUntil(data.scholarship.deadline)} days left</span></div>
            <p className="card-kicker">SCHOLARSHIP GOAL</p>
            <h3>{data.scholarship.name}</h3>
            <div className="progress-line"><i style={{ width: `${scholarshipProgress}%` }} /></div>
            <div className="progress-meta"><span>{requirementsDone} of {data.scholarship.requirements.length} complete</span><strong>{scholarshipProgress}%</strong></div>
            <div className="goal-footer"><span>Deadline · {formatDate(data.scholarship.deadline, { year: 'numeric' })}</span><ArrowRight size={17} /></div>
          </button>

          <button className="card goal-card weight-card" onClick={() => setPage('weight')}>
            <div className="goal-card-top"><span className="goal-icon green"><Scale size={19} /></span><span className="trend-pill"><TrendingDown size={13} /> On track</span></div>
            <p className="card-kicker">WEIGHT GOAL</p>
            <div className="weight-summary"><h3>{latest}<small> kg</small></h3><span><ArrowDownRight size={15} /> {Math.abs(change)} kg</span></div>
            <MiniChart data={data.weights} />
            <div className="goal-footer"><span>Started at {start} kg</span><span>Goal 75 kg</span></div>
          </button>
        </div>
      </section>

      <section className="bottom-grid">
        <ScheduleCard workouts={data.workouts} onOpen={() => setPage('wellness')} />
        <NutritionCard meals={data.meals} onOpen={() => setPage('wellness')} />
      </section>
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete, detailed = false }) {
  return (
    <div className={`task-row ${task.completed ? 'completed' : ''}`}>
      <button className="task-check" onClick={() => onToggle(task.id)} aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}>
        {task.completed ? <Check size={14} strokeWidth={3} /> : null}
      </button>
      <div className="task-time">{task.time}</div>
      <div className="task-copy"><strong>{task.title}</strong>{detailed && <small>{formatDate(task.date, { weekday: 'short' })}</small>}</div>
      <span className={`category-tag ${categoryClass(task.category)}`}>{task.category}</span>
      {onDelete && <button className="row-delete" onClick={() => onDelete(task.id)} aria-label="Delete task"><Trash2 size={16} /></button>}
    </div>
  )
}

function TaskPage({ data, setData }) {
  const [filter, setFilter] = useState('All')
  const [dayFilter, setDayFilter] = useState('all')
  const [form, setForm] = useState({ title: '', time: '09:00', category: 'Personal', date: localISO() })
  const [formMessage, setFormMessage] = useState(null)
  const taskInputRef = useRef(null)
  const categories = ['All', 'Personal', 'Study', 'Scholarship', 'Fitness', 'Wellness']

  const addTask = (event) => {
    event.preventDefault()
    if (!form.title.trim()) {
      setFormMessage({ type: 'error', text: 'Enter a task name before adding it.' })
      taskInputRef.current?.focus()
      return
    }
    if (!form.date || !form.time) {
      setFormMessage({ type: 'error', text: 'Choose both a date and a time for this task.' })
      return
    }
    const time = new Date(`2000-01-01T${form.time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    setData((current) => ({ ...current, tasks: [...current.tasks, { ...form, title: form.title.trim(), time, id: crypto.randomUUID(), completed: false }] }))
    setFilter('All')
    setDayFilter(form.date)
    setFormMessage({ type: 'success', text: `“${form.title.trim()}” was added to your plan.` })
    setForm((current) => ({ ...current, title: '' }))
  }
  const toggleTask = (id) => setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task) }))
  const deleteTask = (id) => setData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }))
  const taskDays = useMemo(() => [...new Set(data.tasks.map((task) => task.date))].sort(), [data.tasks])
  const visibleTasks = data.tasks
    .filter((task) => (filter === 'All' || task.category === filter) && (dayFilter === 'all' || task.date === dayFilter))
    .sort((a, b) => a.date.localeCompare(b.date))
  const groupedTasks = visibleTasks.reduce((groups, task) => {
    if (!groups[task.date]) groups[task.date] = []
    groups[task.date].push(task)
    return groups
  }, {})
  const done = data.tasks.filter((task) => task.completed).length

  useEffect(() => {
    if (dayFilter !== 'all' && !taskDays.includes(dayFilter)) setDayFilter('all')
  }, [dayFilter, taskDays])

  const dayName = (value) => {
    if (value === localISO()) return 'Today'
    if (value === addDays(1)) return 'Tomorrow'
    if (value === addDays(-1)) return 'Yesterday'
    return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(`${value}T12:00:00`))
  }

  return (
    <div className="page-stack inner-page">
      <PageIntro eyebrow="DAILY ACTIVITIES" title="Make space for what matters." text="Capture every task, choose a time, and move through your day with intention." icon={LayoutList} />

      <div className="stats-row">
        <StatCard icon={CheckCircle2} label="Completed" value={done} helper={`${data.tasks.length - done} still open`} tone="green" />
        <StatCard icon={Flame} label="Current streak" value="8 days" helper="Your personal best" tone="coral" />
        <StatCard icon={Target} label="Weekly rate" value={`${Math.round((done / Math.max(data.tasks.length, 1)) * 100)}%`} helper="Keep it moving" tone="purple" />
      </div>

      <div className="card form-card">
        <div className="card-head"><div><span className="card-kicker">QUICK ADD</span><h2>What needs to get done?</h2></div></div>
        <form className="task-form" onSubmit={addTask}>
          <label className="wide-input"><span>Task name <i>Required</i></span><input ref={taskInputRef} value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); if (formMessage?.type === 'error') setFormMessage(null) }} placeholder="e.g. Finish scholarship essay" autoFocus aria-invalid={formMessage?.type === 'error'} /></label>
          <label><span>Date</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label><span>Time</span><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
          <label><span>Category</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.slice(1).map((category) => <option key={category}>{category}</option>)}</select></label>
          <button className="primary-button" type="submit"><Plus size={17} /> Add task</button>
        </form>
        {formMessage && <div className={`form-message ${formMessage.type}`} role="status" aria-live="polite">{formMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<span>{formMessage.text}</span></div>}
      </div>

      <div className="card large-list-card">
        <div className="list-toolbar">
          <div><span className="card-kicker">YOUR PLAN</span><h2>All activities</h2></div>
          <div className="filter-pills">{categories.map((category) => <button key={category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>{category}</button>)}</div>
        </div>
        <div className="day-tabs" role="tablist" aria-label="Filter activities by day">
          <button className={`day-tab all-days ${dayFilter === 'all' ? 'active' : ''}`} onClick={() => setDayFilter('all')} role="tab" aria-selected={dayFilter === 'all'}>
            <span className="day-tab-icon"><CalendarDays size={17} /></span>
            <span><strong>All days</strong><small>Complete schedule</small></span>
            <i>{data.tasks.length}</i>
          </button>
          {taskDays.map((date) => {
            const count = data.tasks.filter((task) => task.date === date).length
            return <button key={date} className={`day-tab ${dayFilter === date ? 'active' : ''}`} onClick={() => setDayFilter(date)} role="tab" aria-selected={dayFilter === date}>
              <span><strong>{dayName(date)}</strong><small>{formatDate(date, { year: 'numeric' })}</small></span>
              <i>{count}</i>
            </button>
          })}
        </div>
        {visibleTasks.length ? <div className="task-day-groups">
          {Object.entries(groupedTasks).map(([date, tasks]) => {
            const completedForDay = tasks.filter((task) => task.completed).length
            const dateObject = new Date(`${date}T12:00:00`)
            return <section className="task-day-group" key={date}>
              <header className="task-day-heading">
                <span className="date-tile"><small>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(dateObject)}</small><strong>{dateObject.getDate()}</strong></span>
                <div><strong>{dayName(date)}</strong><span>{formatDate(date, { weekday: 'long', year: 'numeric' })}</span></div>
                <span className="day-completion"><CheckCircle2 size={15} /> {completedForDay} of {tasks.length} done</span>
              </header>
              <div className="task-list detailed">
                {tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />)}
              </div>
            </section>
          })}
        </div> : <EmptyState icon={CheckCircle2} title="Nothing here yet" text="Add a task above or try a different filter." />}
      </div>
    </div>
  )
}

function PageIntro({ eyebrow, title, text, icon: Icon }) {
  return (
    <section className="page-intro">
      <div><p className="eyebrow"><span /> {eyebrow}</p><h1>{title}</h1><p>{text}</p></div>
      <span className="intro-icon"><Icon size={28} /></span>
    </section>
  )
}

function StatCard({ icon: Icon, label, value, helper, tone }) {
  return <div className="card stat-card"><span className={`stat-icon ${tone}`}><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div>
}

function ScholarshipPage({ data, setData }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.scholarship)
  const [newRequirement, setNewRequirement] = useState('')
  const scholarship = data.scholarship
  const done = scholarship.requirements.filter((item) => item.done).length
  const progress = Math.round((done / Math.max(scholarship.requirements.length, 1)) * 100)

  const toggleRequirement = (id) => setData((current) => ({
    ...current,
    scholarship: { ...current.scholarship, requirements: current.scholarship.requirements.map((item) => item.id === id ? { ...item, done: !item.done } : item) },
  }))
  const deleteRequirement = (id) => setData((current) => ({ ...current, scholarship: { ...current.scholarship, requirements: current.scholarship.requirements.filter((item) => item.id !== id) } }))
  const addRequirement = (event) => {
    event.preventDefault()
    if (!newRequirement.trim()) return
    setData((current) => ({ ...current, scholarship: { ...current.scholarship, requirements: [...current.scholarship.requirements, { id: crypto.randomUUID(), title: newRequirement.trim(), done: false }] } }))
    setNewRequirement('')
  }
  const saveDetails = (event) => {
    event.preventDefault()
    setData((current) => ({ ...current, scholarship: { ...current.scholarship, ...draft } }))
    setEditing(false)
  }

  return (
    <div className="page-stack inner-page">
      <PageIntro eyebrow="SCHOLARSHIP" title="Turn ambition into an application." text="Keep every detail, deadline, and requirement in one calm place." icon={Award} />
      <section className="scholarship-hero card">
        <div className="scholarship-main">
          <span className="scholarship-mark"><Award size={29} /></span>
          <div><span className="card-kicker">ACTIVE APPLICATION</span><h2>{scholarship.name}</h2><p>{scholarship.provider}</p></div>
        </div>
        <div className="deadline-display"><span>Deadline</span><strong>{formatDate(scholarship.deadline, { year: 'numeric' })}</strong><small>{daysUntil(scholarship.deadline)} days remaining</small></div>
        <div className="amount-display"><span>Award</span><strong>{scholarship.amount}</strong><small>Potential funding</small></div>
        <button className="secondary-button" onClick={() => { setDraft(scholarship); setEditing(true) }}><Edit3 size={16} /> Edit details</button>
      </section>

      <section className="two-col-grid scholarship-layout">
        <div className="card requirements-card">
          <div className="card-head">
            <div><span className="card-kicker">APPLICATION CHECKLIST</span><h2>Requirements</h2></div>
            <div className="percent-badge">{progress}%</div>
          </div>
          <div className="progress-line large"><i style={{ width: `${progress}%` }} /></div>
          <p className="requirements-summary">{done} of {scholarship.requirements.length} steps completed</p>
          <div className="requirement-list">
            {scholarship.requirements.map((item) => (
              <div className={`requirement-row ${item.done ? 'done' : ''}`} key={item.id}>
                <button onClick={() => toggleRequirement(item.id)}>{item.done ? <Check size={14} strokeWidth={3} /> : null}</button>
                <span>{item.title}</span>
                <button className="row-delete" onClick={() => deleteRequirement(item.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <form className="inline-add" onSubmit={addRequirement}><input value={newRequirement} onChange={(e) => setNewRequirement(e.target.value)} placeholder="Add another requirement..." /><button><Plus size={17} /> Add</button></form>
        </div>
        <div className="side-column">
          <div className="card detail-card"><span className="detail-icon"><FileText size={20} /></span><div><span className="card-kicker">ABOUT THIS SCHOLARSHIP</span><h3>Important details</h3><p>{scholarship.notes}</p></div></div>
          <div className="card countdown-card"><div><span className="card-kicker">TIME REMAINING</span><strong>{daysUntil(scholarship.deadline)}</strong><span>days</span></div><div className="calendar-graphic"><CalendarDays size={25} /><span>{formatDate(scholarship.deadline)}</span></div></div>
          <div className="motivation-card"><Sparkles size={21} /><div><strong>You’re making progress.</strong><span>Complete one small step today.</span></div></div>
        </div>
      </section>

      {editing && <Modal title="Edit scholarship details" onClose={() => setEditing(false)}>
        <form className="modal-form" onSubmit={saveDetails}>
          <label><span>Scholarship name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
          <label><span>Provider</span><input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} /></label>
          <div className="form-row"><label><span>Award amount</span><input value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></label><label><span>Deadline</span><input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} required /></label></div>
          <label><span>Details & eligibility</span><textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows="4" /></label>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button">Save changes</button></div>
        </form>
      </Modal>}
    </div>
  )
}

function WeightPage({ data, setData }) {
  const [weight, setWeight] = useState('')
  const [date, setDate] = useState(localISO())
  const sorted = useMemo(() => [...data.weights].sort((a, b) => a.date.localeCompare(b.date)), [data.weights])
  const latest = sorted.at(-1)?.value || 0
  const first = sorted.at(0)?.value || latest
  const lost = first - latest
  const goal = 75
  const remaining = Math.max(0, latest - goal)

  const addWeight = (event) => {
    event.preventDefault()
    const value = Number(weight)
    if (!value || value < 20 || value > 400) return
    setData((current) => {
      const withoutDate = current.weights.filter((entry) => entry.date !== date)
      return { ...current, weights: [...withoutDate, { id: crypto.randomUUID(), date, value }].sort((a, b) => a.date.localeCompare(b.date)) }
    })
    setWeight('')
  }
  const removeWeight = (id) => setData((current) => ({ ...current, weights: current.weights.filter((entry) => entry.id !== id) }))

  return (
    <div className="page-stack inner-page">
      <PageIntro eyebrow="WEIGHT LOSS" title="Progress you can actually see." text="Log each check-in and focus on the direction—not a single day." icon={Scale} />
      <div className="stats-row weight-stats">
        <StatCard icon={Scale} label="Current weight" value={`${latest} kg`} helper={`Started at ${first} kg`} tone="green" />
        <StatCard icon={TrendingDown} label="Total change" value={`${lost >= 0 ? '-' : '+'}${Math.abs(lost).toFixed(1)} kg`} helper="Since your first entry" tone="coral" />
        <StatCard icon={Target} label="To your goal" value={`${remaining.toFixed(1)} kg`} helper={`Goal weight: ${goal} kg`} tone="purple" />
      </div>

      <section className="card chart-card">
        <div className="card-head"><div><span className="card-kicker">YOUR TREND</span><h2>Weight over time</h2></div><span className="trend-pill"><TrendingDown size={14} /> {lost.toFixed(1)} kg overall</span></div>
        <WeightChart data={sorted} goal={goal} />
      </section>

      <section className="two-col-grid weight-layout">
        <div className="card log-card">
          <div className="card-head"><div><span className="card-kicker">NEW CHECK-IN</span><h2>Log your weight</h2></div><span className="goal-icon green"><Scale size={19} /></span></div>
          <form className="weight-form" onSubmit={addWeight}>
            <label><span>Weight (kg)</span><div className="unit-input"><input type="number" min="20" max="400" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="79.4" required /><i>kg</i></div></label>
            <label><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            <button className="primary-button"><Plus size={17} /> Add check-in</button>
          </form>
          <p className="form-note"><HeartPulse size={15} /> Daily fluctuations are normal. Weekly trends tell the real story.</p>
        </div>
        <div className="card history-card">
          <div className="card-head"><div><span className="card-kicker">HISTORY</span><h2>Recent check-ins</h2></div></div>
          <div className="weight-history">
            {[...sorted].reverse().slice(0, 5).map((entry, index, array) => {
              const prior = sorted[sorted.findIndex((item) => item.id === entry.id) - 1]
              const delta = prior ? entry.value - prior.value : 0
              return <div key={entry.id}><span>{formatDate(entry.date, { weekday: 'short' })}</span><strong>{entry.value} kg</strong><small className={delta <= 0 ? 'down' : 'up'}>{prior ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : 'Start'}</small><button onClick={() => removeWeight(entry.id)}><Trash2 size={15} /></button></div>
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

function WeightChart({ data, goal }) {
  const width = 850
  const height = 290
  const padding = { top: 25, right: 25, bottom: 42, left: 48 }
  if (data.length < 2) return <EmptyState icon={Activity} title="Your trend begins here" text="Add at least two check-ins to see a line chart." />
  const values = [...data.map((entry) => entry.value), goal]
  const min = Math.floor(Math.min(...values) - 1)
  const max = Math.ceil(Math.max(...values) + 1)
  const x = (index) => padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right)
  const y = (value) => padding.top + ((max - value) / (max - min)) * (height - padding.top - padding.bottom)
  const points = data.map((entry, index) => `${x(index)},${y(entry.value)}`).join(' ')
  const fillPoints = `${padding.left},${height - padding.bottom} ${points} ${x(data.length - 1)},${height - padding.bottom}`
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) / 4) * index)
  return (
    <div className="chart-wrap">
      <svg className="weight-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weight progress line chart">
        <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#798c70" stopOpacity="0.22" /><stop offset="100%" stopColor="#798c70" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((tick) => <g key={tick}><line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className="grid-line" /><text x={padding.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-label">{tick.toFixed(0)}</text></g>)}
        <line x1={padding.left} x2={width - padding.right} y1={y(goal)} y2={y(goal)} className="goal-line" />
        <text x={width - padding.right} y={y(goal) - 8} textAnchor="end" className="goal-label">Goal {goal} kg</text>
        <polygon points={fillPoints} fill="url(#chartFill)" />
        <polyline points={points} className="chart-line" />
        {data.map((entry, index) => <g key={entry.id}><circle cx={x(index)} cy={y(entry.value)} r="5" className="chart-dot" /><text x={x(index)} y={height - 15} textAnchor="middle" className="axis-label">{formatDate(entry.date)}</text></g>)}
      </svg>
    </div>
  )
}

function MiniChart({ data }) {
  if (data.length < 2) return null
  const values = data.map((item) => item.value)
  const min = Math.min(...values) - 0.3
  const max = Math.max(...values) + 0.3
  const points = data.map((item, index) => `${(index / (data.length - 1)) * 220},${8 + ((max - item.value) / (max - min)) * 48}`).join(' ')
  return <svg className="mini-chart" viewBox="0 0 220 65" preserveAspectRatio="none"><polyline points={points} /><circle cx="220" cy={points.split(' ').at(-1).split(',')[1]} r="4" /></svg>
}

function WellnessPage({ data, setData }) {
  const [activeTab, setActiveTab] = useState('gym')
  const [workoutForm, setWorkoutForm] = useState({ day: 'MON', title: '', detail: '', time: '18:30' })
  const [mealForm, setMealForm] = useState({ type: 'Breakfast', title: '', detail: '', calories: '' })
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

  const addWorkout = (event) => {
    event.preventDefault()
    if (!workoutForm.title.trim()) return
    const time = new Date(`2000-01-01T${workoutForm.time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    setData((current) => ({ ...current, workouts: [...current.workouts, { ...workoutForm, title: workoutForm.title.trim(), id: crypto.randomUUID(), time, done: false }] }))
    setWorkoutForm((current) => ({ ...current, title: '', detail: '' }))
  }
  const addMeal = (event) => {
    event.preventDefault()
    if (!mealForm.title.trim()) return
    setData((current) => ({ ...current, meals: [...current.meals, { ...mealForm, id: crypto.randomUUID(), calories: Number(mealForm.calories) || 0 }] }))
    setMealForm((current) => ({ ...current, title: '', detail: '', calories: '' }))
  }
  const toggleWorkout = (id) => setData((current) => ({ ...current, workouts: current.workouts.map((item) => item.id === id ? { ...item, done: !item.done } : item) }))

  return (
    <div className="page-stack inner-page">
      <PageIntro eyebrow="WELLNESS PLAN" title="Train well. Eat well. Feel better." text="Shape a routine that supports your goals and still works in real life." icon={HeartPulse} />
      <div className="segment-tabs"><button className={activeTab === 'gym' ? 'active' : ''} onClick={() => setActiveTab('gym')}><Dumbbell size={18} /> Gym schedule</button><button className={activeTab === 'meals' ? 'active' : ''} onClick={() => setActiveTab('meals')}><Utensils size={18} /> Meal plan</button></div>

      {activeTab === 'gym' ? <>
        <div className="card form-card">
          <div className="card-head"><div><span className="card-kicker">PLAN A SESSION</span><h2>Add to your gym schedule</h2></div></div>
          <form className="task-form wellness-form" onSubmit={addWorkout}>
            <label><span>Day</span><select value={workoutForm.day} onChange={(e) => setWorkoutForm({ ...workoutForm, day: e.target.value })}>{days.map((day) => <option key={day}>{day}</option>)}</select></label>
            <label className="wide-input"><span>Workout</span><input value={workoutForm.title} onChange={(e) => setWorkoutForm({ ...workoutForm, title: e.target.value })} placeholder="e.g. Back & biceps" required /></label>
            <label className="wide-input"><span>Focus</span><input value={workoutForm.detail} onChange={(e) => setWorkoutForm({ ...workoutForm, detail: e.target.value })} placeholder="Exercises or muscle groups" /></label>
            <label><span>Time</span><input type="time" value={workoutForm.time} onChange={(e) => setWorkoutForm({ ...workoutForm, time: e.target.value })} /></label>
            <button className="primary-button"><Plus size={17} /> Add session</button>
          </form>
        </div>
        <div className="workout-grid">
          {days.map((day) => {
            const sessions = data.workouts.filter((item) => item.day === day)
            return <div className={`day-card card ${sessions.length ? 'has-session' : ''}`} key={day}><div className="day-card-head"><strong>{day}</strong><span>{sessions.length ? `${sessions.length} session${sessions.length > 1 ? 's' : ''}` : 'Rest day'}</span></div>{sessions.length ? sessions.map((session) => <div className={`session-item ${session.done ? 'done' : ''}`} key={session.id}><span className="session-icon"><Dumbbell size={18} /></span><div><strong>{session.title}</strong><p>{session.detail || 'Planned workout'}</p><small><Clock3 size={13} /> {session.time}</small></div><button className="task-check" onClick={() => toggleWorkout(session.id)}>{session.done && <Check size={14} strokeWidth={3} />}</button></div>) : <div className="rest-illustration"><span>●</span><p>Recovery builds strength, too.</p></div>}</div>
          })}
        </div>
      </> : <>
        <div className="card form-card">
          <div className="card-head"><div><span className="card-kicker">PLAN A MEAL</span><h2>Add something nourishing</h2></div></div>
          <form className="task-form wellness-form" onSubmit={addMeal}>
            <label><span>Meal</span><select value={mealForm.type} onChange={(e) => setMealForm({ ...mealForm, type: e.target.value })}>{['Breakfast', 'Lunch', 'Dinner', 'Snack'].map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="wide-input"><span>Dish</span><input value={mealForm.title} onChange={(e) => setMealForm({ ...mealForm, title: e.target.value })} placeholder="e.g. Turkey avocado wrap" required /></label>
            <label className="wide-input"><span>Ingredients / notes</span><input value={mealForm.detail} onChange={(e) => setMealForm({ ...mealForm, detail: e.target.value })} placeholder="What goes in it?" /></label>
            <label><span>Calories</span><input type="number" value={mealForm.calories} onChange={(e) => setMealForm({ ...mealForm, calories: e.target.value })} placeholder="450" /></label>
            <button className="primary-button"><Plus size={17} /> Add meal</button>
          </form>
        </div>
        <div className="meal-grid">
          {data.meals.map((meal) => <div className="card meal-card" key={meal.id}><div className="meal-type"><span className={`meal-icon ${meal.type.toLowerCase()}`}><Utensils size={19} /></span><span>{meal.type}</span></div><h3>{meal.title}</h3><p>{meal.detail}</p><div><strong>{meal.calories}</strong><span> kcal</span><button onClick={() => setData((current) => ({ ...current, meals: current.meals.filter((item) => item.id !== meal.id) }))}><Trash2 size={15} /></button></div></div>)}
        </div>
        <div className="nutrition-total card"><span className="stat-icon green"><Beef size={19} /></span><div><span>Planned energy</span><strong>{data.meals.reduce((sum, meal) => sum + Number(meal.calories), 0).toLocaleString()} kcal</strong></div><p>A balanced plan is one you can enjoy and repeat.</p></div>
      </>}
    </div>
  )
}

function ScheduleCard({ workouts, onOpen }) {
  return <div className="card schedule-card"><div className="card-head"><div><span className="card-kicker">THIS WEEK</span><h2>Gym schedule</h2></div><button className="text-button" onClick={onOpen}>Full schedule <ArrowRight size={15} /></button></div><div className="workout-list">{workouts.slice(0, 3).map((workout) => <div key={workout.id}><span className="day-badge">{workout.day}</span><div><strong>{workout.title}</strong><small>{workout.detail}</small></div><span className="workout-time">{workout.time}</span>{workout.done ? <CheckCircle2 size={18} className="done-icon" /> : <Circle size={18} className="open-icon" />}</div>)}</div></div>
}

function NutritionCard({ meals, onOpen }) {
  const total = meals.reduce((sum, meal) => sum + Number(meal.calories), 0)
  return <div className="card nutrition-card"><div className="card-head"><div><span className="card-kicker">TODAY’S FUEL</span><h2>Meal plan</h2></div><button className="text-button" onClick={onOpen}>View plan <ArrowRight size={15} /></button></div><div className="nutrition-inner"><div className="calorie-ring"><div><Utensils size={20} /><strong>{total.toLocaleString()}</strong><span>kcal planned</span></div></div><div className="meal-list">{meals.slice(0, 3).map((meal) => <div key={meal.id}><span className={`meal-dot ${meal.type.toLowerCase()}`} /><div><strong>{meal.type}</strong><small>{meal.title}</small></div><span>{meal.calories}</span></div>)}</div></div></div>
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handler = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={19} /></button></div>{children}</div></div>
}

function EmptyState({ icon: Icon, title, text }) {
  return <div className="empty-state"><span><Icon size={23} /></span><strong>{title}</strong><p>{text}</p></div>
}

function App() {
  const [page, setPage] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [data, setData, apiStatus, retryApi] = useDashboardData()
  const titles = { overview: 'Overview', daily: 'Daily activities', scholarship: 'Scholarship', weight: 'Weight loss', wellness: 'Gym & meals' }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} open={menuOpen} setOpen={setMenuOpen} />
      <main className="main-area">
        <Topbar title={titles[page]} onMenu={() => setMenuOpen(true)} apiStatus={apiStatus} onRetry={retryApi} />
        <div className="page-content">
          {page === 'overview' && <Overview data={data} setData={setData} setPage={setPage} />}
          {page === 'daily' && <TaskPage data={data} setData={setData} />}
          {page === 'scholarship' && <ScholarshipPage data={data} setData={setData} />}
          {page === 'weight' && <WeightPage data={data} setData={setData} />}
          {page === 'wellness' && <WellnessPage data={data} setData={setData} />}
        </div>
      </main>
    </div>
  )
}

export default App
