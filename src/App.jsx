import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Award,
  Beef,
  Bell,
  Brain,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  CloudOff,
  Dumbbell,
  Edit3,
  FileText,
  Flame,
  HeartPulse,
  LayoutList,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Shield,
  Sparkles,
  Star,
  Swords,
  Target,
  Trash2,
  TrendingDown,
  Trophy,
  Utensils,
  X,
  Zap,
} from 'lucide-react'

const STORAGE_KEY = 'daymark-dashboard-v1'
const WORKSPACE_KEY = 'daymark-workspace-id'
const SHARED_WORKSPACE_ID = 'tkrowling-dashboard'
const NOTIFICATION_READ_KEY = 'daymark-notifications-read-v1'
const NOTIFICATION_SENT_KEY = 'daymark-notifications-sent-v1'

const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S']
const RANK_FORMS = {
  E: { minLevel: 1, title: 'Awakened Recruit', asset: '/characters/shadow-hunter-rank-e.png' },
  D: { minLevel: 4, title: 'Shadow Initiate', asset: '/characters/shadow-hunter-rank-d.png' },
  C: { minLevel: 7, title: 'Night Vanguard', asset: '/characters/shadow-hunter-rank-c.png' },
  B: { minLevel: 12, title: 'Abyss Knight', asset: '/characters/shadow-hunter-rank-b.png' },
  A: { minLevel: 18, title: 'Shadow Commander', asset: '/characters/shadow-hunter-rank-a.png' },
  S: { minLevel: 25, title: 'Eclipse Sovereign', asset: '/characters/shadow-hunter-rank-s.png' },
}

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
    { id: crypto.randomUUID(), title: '30-minute morning walk', time: '7:30 AM', end_time: '8:00 AM', category: 'Wellness', date: localISO(), completed: true },
    { id: crypto.randomUUID(), title: 'Review scholarship essay', time: '10:00 AM', end_time: '11:00 AM', category: 'Scholarship', date: localISO(), completed: false },
    { id: crypto.randomUUID(), title: 'Complete reading assignment', time: '2:00 PM', end_time: '3:00 PM', category: 'Study', date: localISO(), completed: false },
    { id: crypto.randomUUID(), title: 'Upper body workout', time: '6:30 PM', end_time: '7:30 PM', category: 'Fitness', date: localISO(), completed: false },
    { id: crypto.randomUUID(), title: 'Plan tomorrow’s priorities', time: '9:00 PM', end_time: '9:30 PM', category: 'Personal', date: localISO(), completed: false },
  ],
  missions: [],
  scholarships: [{
    id: crypto.randomUUID(),
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
  }],
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

function normalizeDashboard(value) {
  const { scholarship: legacyScholarship, ...dashboard } = value
  const scholarships = Array.isArray(value.scholarships) && value.scholarships.length
    ? value.scholarships
    : legacyScholarship
      ? [{ ...legacyScholarship, id: legacyScholarship.id || crypto.randomUUID() }]
      : []
  return { ...dashboard, scholarships }
}

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
      return saved ? normalizeDashboard(JSON.parse(saved)) : seedData()
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
        const { synced_at: _syncedAt, ...responseData } = await response.json()
        const dashboard = normalizeDashboard(responseData)
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
const missionCompletionDates = (mission) => mission.completion_dates ?? (mission.completed ? [mission.date] : [])
const missionDoneOn = (mission, date) => missionCompletionDates(mission).includes(date)

function dateAtTime(date, time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return new Date(`${date}T00:00:00`)
  let hours = Number(match[1])
  const minutes = Number(match[2])
  const period = match[3]?.toUpperCase()
  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  const result = new Date(`${date}T00:00:00`)
  result.setHours(hours, minutes, 0, 0)
  return result
}

function buildNotificationItems(data) {
  const now = new Date()
  const today = localISO(now)
  const taskHorizon = now.getTime() + (7 * 86_400_000)
  const tasks = (data.tasks ?? [])
    .filter((task) => !task.completed)
    .map((task) => ({ task, startsAt: dateAtTime(task.date, task.time) }))
    .filter(({ startsAt }) => startsAt.getTime() >= now.getTime() && startsAt.getTime() <= taskHorizon)
    .map(({ task, startsAt }) => ({
      id: `task-${task.id}-${task.date}`,
      kind: 'task',
      title: task.title,
      text: `${task.date === today ? 'Today' : formatDate(task.date, { weekday: 'short' })} · ${task.time}${task.end_time ? ` – ${task.end_time}` : ''}`,
      when: startsAt.getTime(),
    }))

  const scholarships = (data.scholarships ?? [])
    .map((scholarship) => {
      const deadline = new Date(`${scholarship.deadline}T23:59:59`)
      const remaining = Math.ceil((deadline - now) / 86_400_000)
      return { scholarship, deadline, remaining }
    })
    .filter(({ remaining }) => remaining >= 0 && remaining <= 30)
    .map(({ scholarship, deadline, remaining }) => ({
      id: `scholarship-${scholarship.id}-${scholarship.deadline}`,
      kind: 'scholarship',
      title: scholarship.name,
      text: remaining === 0 ? 'Deadline is today' : `${remaining} day${remaining === 1 ? '' : 's'} until deadline`,
      when: deadline.getTime(),
    }))

  const openMissions = (data.missions ?? []).filter((mission) => mission.date <= today && !missionDoneOn(mission, today))
  const missions = openMissions.length ? [{
    id: `missions-${today}`,
    kind: 'mission',
    title: 'Daily missions remaining',
    text: `${openMissions.length} mission${openMissions.length === 1 ? '' : 's'} still waiting to be cleared`,
    when: new Date(`${today}T23:59:59`).getTime(),
  }] : []

  return [...tasks, ...scholarships, ...missions].sort((a, b) => a.when - b.when)
}

async function showBrowserNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready
    await registration.showNotification(title, { body, tag, renotify: false, data: { url: window.location.origin } })
    return
  }
  new Notification(title, { body, tag })
}

function useNotificationCenter(data) {
  const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported')
  const [clock, setClock] = useState(() => Date.now())
  const [readIds, setReadIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTIFICATION_READ_KEY) || '[]') } catch { return [] }
  })
  const items = useMemo(() => buildNotificationItems(data), [data, clock])
  const unreadCount = items.filter((item) => !readIds.includes(item.id)).length

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/notification-sw.js').catch(() => undefined)
    const clockTimer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(clockTimer)
  }, [])

  useEffect(() => {
    if (permission !== 'granted') return undefined
    const checkReminders = () => {
      let sent
      try { sent = JSON.parse(localStorage.getItem(NOTIFICATION_SENT_KEY) || '[]') } catch { sent = [] }
      const sentSet = new Set(sent)
      const now = new Date()
      const reminders = []

      for (const task of data.tasks ?? []) {
        if (task.completed) continue
        const startsAt = dateAtTime(task.date, task.time)
        const minutes = Math.round((startsAt - now) / 60_000)
        if (minutes >= 0 && minutes <= 15) reminders.push({ key: `task-${task.id}-${task.date}`, title: `Upcoming: ${task.title}`, body: minutes <= 1 ? `Starts now · ${task.category}` : `Starts in ${minutes} minutes · ${task.category}` })
      }
      for (const scholarship of data.scholarships ?? []) {
        const remaining = Math.ceil((new Date(`${scholarship.deadline}T23:59:59`) - now) / 86_400_000)
        if ([7, 3, 1, 0].includes(remaining)) reminders.push({ key: `deadline-${scholarship.id}-${remaining}`, title: scholarship.name, body: remaining === 0 ? 'The application deadline is today.' : `${remaining} day${remaining === 1 ? '' : 's'} until the application deadline.` })
      }
      const notificationDate = localISO(now)
      const openMissions = (data.missions ?? []).filter((mission) => mission.date <= notificationDate && !missionDoneOn(mission, notificationDate))
      if (now.getHours() >= 18 && openMissions.length) reminders.push({ key: `missions-${localISO(now)}`, title: 'Daily missions incomplete', body: `${openMissions.length} mission${openMissions.length === 1 ? '' : 's'} remain today.` })

      for (const reminder of reminders) {
        if (sentSet.has(reminder.key)) continue
        sentSet.add(reminder.key)
        void showBrowserNotification(reminder.title, reminder.body, reminder.key)
      }
      localStorage.setItem(NOTIFICATION_SENT_KEY, JSON.stringify([...sentSet].slice(-200)))
    }
    checkReminders()
    const timer = window.setInterval(checkReminders, 60_000)
    return () => window.clearInterval(timer)
  }, [data, permission])

  const enable = async () => {
    if (!('Notification' in window)) return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') void showBrowserNotification('Daymark notifications enabled', 'Activity and scholarship reminders are now active.', 'daymark-enabled')
    } catch {
      setPermission('unsupported')
    }
  }
  const markAllRead = () => {
    const next = [...new Set([...readIds, ...items.map((item) => item.id)])]
    setReadIds(next)
    localStorage.setItem(NOTIFICATION_READ_KEY, JSON.stringify(next.slice(-300)))
  }

  return { items, unreadCount, permission, enable, markAllRead, isUnread: (id) => !readIds.includes(id) }
}

function Sidebar({ page, setPage, open, setOpen, scholarshipCount }) {
  const nav = [
    { id: 'system', label: 'Ascension system', icon: Swords },
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
        <button className="brand" onClick={() => navigate('system')}>
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
                {id === 'scholarship' && <span className="nav-badge">{scholarshipCount}</span>}
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

function Topbar({ title, onMenu, apiStatus, onRetry, data }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notifications = useNotificationCenter(data)
  const prettyDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  return (
    <>
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
          <button className="icon-button notification" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications" aria-expanded={notificationsOpen}>
            <Bell size={19} />
            {notifications.unreadCount > 0 && <span className="notification-count">{Math.min(notifications.unreadCount, 9)}{notifications.unreadCount > 9 ? '+' : ''}</span>}
          </button>
        </div>
      </header>
      {notificationsOpen && <>
        <button className="notification-shade" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications" />
        <aside className="notification-panel" aria-label="Notification center">
          <div className="notification-panel-head"><div><span>REMINDERS</span><h2>Notifications</h2></div><button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={19} /></button></div>
          <div className={`notification-permission ${notifications.permission}`}>
            <span>{notifications.permission === 'granted' ? <CheckCircle2 size={18} /> : <Bell size={18} />}</span>
            <div><strong>{notifications.permission === 'granted' ? 'Browser alerts are on' : notifications.permission === 'denied' ? 'Browser alerts are blocked' : notifications.permission === 'unsupported' ? 'Browser alerts unavailable' : 'Enable browser alerts'}</strong><p>{notifications.permission === 'granted' ? 'We will remind you about activities and deadlines.' : notifications.permission === 'denied' ? 'Allow notifications in your browser site settings.' : notifications.permission === 'unsupported' ? 'Your browser does not support native notifications.' : 'Receive reminders even when this panel is closed.'}</p></div>
            {notifications.permission === 'default' && <button onClick={notifications.enable}>Enable</button>}
          </div>
          <div className="notification-list-head"><span>UPCOMING</span>{notifications.unreadCount > 0 && <button onClick={notifications.markAllRead}>Mark all read</button>}</div>
          <div className="notification-list">
            {notifications.items.length ? notifications.items.map((item) => {
              const Icon = item.kind === 'scholarship' ? Award : item.kind === 'mission' ? Swords : Clock3
              const unread = notifications.isUnread(item.id)
              return <div className={`notification-item ${unread ? 'unread' : ''}`} key={item.id}><span className={`notification-kind ${item.kind}`}><Icon size={17} /></span><div><strong>{item.title}</strong><p>{item.text}</p></div>{unread && <i />}</div>
            }) : <div className="notification-empty"><CheckCircle2 size={25} /><strong>You&apos;re all caught up</strong><p>No upcoming reminders in the next few days.</p></div>}
          </div>
        </aside>
      </>}
    </>
  )
}

function TaskRow({ task, onToggle, onDelete, detailed = false }) {
  return (
    <div className={`task-row ${task.completed ? 'completed' : ''}`}>
      <button className="task-check" onClick={() => onToggle(task.id)} aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}>
        {task.completed ? <Check size={14} strokeWidth={3} /> : null}
      </button>
      <div className="task-time">{task.time}{task.end_time ? <><span>–</span>{task.end_time}</> : null}</div>
      <div className="task-copy"><strong>{task.title}</strong>{detailed && <small>{formatDate(task.date, { weekday: 'short' })}</small>}</div>
      <span className={`category-tag ${categoryClass(task.category)}`}>{task.category}</span>
      {onDelete && <button className="row-delete" onClick={() => onDelete(task.id)} aria-label="Delete task"><Trash2 size={16} /></button>}
    </div>
  )
}

function SystemPage({ data, setData }) {
  const [missionFormOpen, setMissionFormOpen] = useState(false)
  const [missionForm, setMissionForm] = useState({ title: '', category: 'Training', xp: 25 })
  const [missionError, setMissionError] = useState('')
  const missionInputRef = useRef(null)
  const missions = data.missions ?? []
  const today = localISO()
  const missionClearCount = missions.reduce((total, mission) => total + missionCompletionDates(mission).length, 0)
  const completedRequirements = (data.scholarships ?? []).flatMap((scholarship) => scholarship.requirements).filter((item) => item.done)
  const completedWorkouts = data.workouts.filter((item) => item.done)
  const weightLogs = Math.max(0, data.weights.length - 1)
  const missionXp = missions.reduce((total, mission) => total + (missionCompletionDates(mission).length * (Number(mission.xp) || 25)), 0)
  const totalXp = missionXp + (completedRequirements.length * 40) + (completedWorkouts.length * 50) + (weightLogs * 15)
  const xpPerLevel = 150
  const level = Math.floor(totalXp / xpPerLevel) + 1
  const currentXp = totalXp % xpPerLevel
  const xpProgress = Math.round((currentXp / xpPerLevel) * 100)
  const rank = level >= 25 ? 'S' : level >= 18 ? 'A' : level >= 12 ? 'B' : level >= 7 ? 'C' : level >= 4 ? 'D' : 'E'
  const rankIndex = RANK_ORDER.indexOf(rank)
  const currentForm = RANK_FORMS[rank]
  const nextRank = RANK_ORDER[rankIndex + 1]
  const nextForm = nextRank ? RANK_FORMS[nextRank] : null
  const evolutionProgress = nextForm
    ? Math.round(((level - currentForm.minLevel) / (nextForm.minLevel - currentForm.minLevel)) * 100)
    : 100
  const todayMissions = missions.filter((mission) => mission.date <= today)
  const todayDone = todayMissions.filter((mission) => missionDoneOn(mission, today)).length
  const dailyProgress = todayMissions.length ? Math.round((todayDone / todayMissions.length) * 100) : 0
  const clearsFor = (categories) => missions
    .filter((mission) => categories.includes(mission.category))
    .reduce((total, mission) => total + missionCompletionDates(mission).length, 0)
  const trainingDone = clearsFor(['Training'])
  const learningDone = clearsFor(['Learning'])
  const wellnessDone = clearsFor(['Wellness'])
  const disciplineDone = clearsFor(['Discipline', 'Challenge'])
  const stats = [
    { label: 'Strength', value: 10 + (trainingDone * 2) + (completedWorkouts.length * 3), icon: Swords },
    { label: 'Vitality', value: 10 + wellnessDone + (weightLogs * 2), icon: Shield },
    { label: 'Focus', value: 10 + (learningDone * 3) + completedRequirements.length, icon: Brain },
    { label: 'Discipline', value: 10 + (disciplineDone * 3) + missionClearCount, icon: Target },
    { label: 'Momentum', value: 10 + missionClearCount + todayDone, icon: Zap },
  ].map((stat) => ({ ...stat, value: Math.min(stat.value, 99) }))

  const openMissionForm = () => {
    setMissionError('')
    setMissionFormOpen(true)
    window.setTimeout(() => missionInputRef.current?.focus(), 0)
  }
  const addMission = (event) => {
    event.preventDefault()
    if (!missionForm.title.trim()) {
      setMissionError('Enter a mission name to continue.')
      missionInputRef.current?.focus()
      return
    }
    const mission = {
      ...missionForm,
      id: crypto.randomUUID(),
      title: missionForm.title.trim(),
      date: localISO(),
      xp: Number(missionForm.xp) || 25,
      completed: false,
      completion_dates: [],
    }
    setData((current) => ({ ...current, missions: [...(current.missions ?? []), mission] }))
    setMissionForm((current) => ({ ...current, title: '' }))
    setMissionError('')
    setMissionFormOpen(false)
  }
  const toggleMission = (id) => setData((current) => ({
    ...current,
    missions: (current.missions ?? []).map((mission) => {
      if (mission.id !== id) return mission
      const completionDates = missionCompletionDates(mission)
      const completeToday = completionDates.includes(today)
      return {
        ...mission,
        completed: !completeToday,
        completion_dates: completeToday ? completionDates.filter((date) => date !== today) : [...completionDates, today],
      }
    }),
  }))
  const deleteMission = (id) => setData((current) => ({
    ...current,
    missions: (current.missions ?? []).filter((mission) => mission.id !== id),
  }))
  const nextMilestone = todayMissions.length && todayDone === todayMissions.length
    ? 'Daily objective cleared. Recovery protocol available.'
    : `${Math.max(todayMissions.length - todayDone, 0)} daily mission${todayMissions.length - todayDone === 1 ? '' : 's'} remain.`

  return (
    <div className="page-stack inner-page system-page">
      <section className="system-hero">
        <div className="system-hero-grid" aria-hidden="true" />
        <div className="system-hero-copy">
          <p className="system-status"><span /> SYSTEM ONLINE</p>
          <h1>Ascension Protocol</h1>
          <p>Turn every real-world objective into progress. Complete quests, earn experience, and build your attributes one day at a time.</p>
          <div className="system-identity"><Shield size={17} /><span>PLAYER</span><strong>TKROWLING</strong><i>ACTIVE</i></div>
        </div>
        <div className={`character-evolution rank-${rank.toLowerCase()}`}>
          <div className="character-art" aria-label={`${currentForm.title}, Rank ${rank}`}>
            <span className="character-scanline" aria-hidden="true" />
            <img key={rank} src={currentForm.asset} alt={`${currentForm.title} character form`} />
            <div className="character-rank-seal"><span>RANK</span><strong>{rank}</strong><small>LV. {level}</small></div>
          </div>
          <div className="character-form-meta">
            <span>SELECTED EVOLUTION · SHADOW HUNTER</span>
            <div><strong>{currentForm.title}</strong><small>{nextForm ? `Next form: Rank ${nextRank} at level ${nextForm.minLevel}` : 'Final evolution awakened'}</small></div>
            <div className="evolution-progress"><i style={{ width: `${evolutionProgress}%` }} /></div>
          </div>
          <div className="rank-ladder" aria-label="Rank evolution path">
            {RANK_ORDER.map((rankName, index) => (
              <span className={`${index < rankIndex ? 'unlocked' : ''} ${rankName === rank ? 'current' : ''}`} key={rankName} title={`${RANK_FORMS[rankName].title} · Level ${RANK_FORMS[rankName].minLevel}`}>
                <i>{rankName}</i><small>LV {RANK_FORMS[rankName].minLevel}</small>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="system-summary-grid">
        <div className="system-panel level-panel">
          <div className="system-panel-head">
            <div><span className="system-code">PLAYER STATUS</span><h2>Level progression</h2></div>
            <span className="level-token"><Star size={16} /> LV. {level}</span>
          </div>
          <div className="level-readout"><strong>{currentXp}</strong><span>/ {xpPerLevel} XP</span><i>{totalXp.toLocaleString()} lifetime XP</i></div>
          <div className="system-progress"><i style={{ width: `${xpProgress}%` }} /></div>
          <div className="system-progress-meta"><span>{xpProgress}% to next level</span><strong>{xpPerLevel - currentXp} XP REQUIRED</strong></div>
          <div className="system-metrics">
            <div><span>DAILY CLEARS</span><strong>{missionClearCount}</strong></div>
            <div><span>TRAINING DONE</span><strong>{completedWorkouts.length}</strong></div>
            <div><span>MILESTONES</span><strong>{completedRequirements.length}</strong></div>
          </div>
        </div>

        <div className="system-panel daily-quest-panel">
          <div className="system-panel-head">
            <div><span className="system-code">DAILY MISSIONS</span><h2>Today&apos;s objectives</h2></div>
            <div className="quest-head-actions">
              <button className="mission-add-button" onClick={openMissionForm}><Plus size={15} /> Add mission</button>
              <span className={`quest-state ${dailyProgress === 100 && todayMissions.length ? 'cleared' : ''}`}>{dailyProgress === 100 && todayMissions.length ? 'CLEARED' : `${dailyProgress}%`}</span>
            </div>
          </div>
          {missionFormOpen && (
            <form className="mission-form" onSubmit={addMission}>
              <label className="mission-title-field"><span>Mission</span><input ref={missionInputRef} value={missionForm.title} onChange={(event) => { setMissionForm({ ...missionForm, title: event.target.value }); setMissionError('') }} placeholder="e.g. Complete 100 push-ups" aria-invalid={Boolean(missionError)} /></label>
              <label><span>Type</span><select value={missionForm.category} onChange={(event) => setMissionForm({ ...missionForm, category: event.target.value })}><option>Training</option><option>Learning</option><option>Discipline</option><option>Wellness</option><option>Challenge</option></select></label>
              <label><span>Reward</span><select value={missionForm.xp} onChange={(event) => setMissionForm({ ...missionForm, xp: Number(event.target.value) })}><option value={15}>15 XP</option><option value={25}>25 XP</option><option value={50}>50 XP</option><option value={100}>100 XP</option></select></label>
              <p className="mission-repeat-note"><RefreshCw size={14} /> Repeats every day. Each daily completion earns this XP again.</p>
              <div className="mission-form-actions"><button className="mission-submit" type="submit"><Plus size={15} /> Assign</button><button className="mission-cancel" type="button" onClick={() => { setMissionFormOpen(false); setMissionError('') }}>Cancel</button></div>
              {missionError && <p className="mission-error"><AlertCircle size={14} /> {missionError}</p>}
            </form>
          )}
          <div className="system-progress compact"><i style={{ width: `${dailyProgress}%` }} /></div>
          <div className="system-quest-list">
            {todayMissions.length ? todayMissions.map((mission) => {
              const completeToday = missionDoneOn(mission, today)
              const totalClears = missionCompletionDates(mission).length
              return <div className={`system-quest ${completeToday ? 'complete' : ''}`} key={mission.id}>
                <button className="quest-toggle" onClick={() => toggleMission(mission.id)} aria-label={completeToday ? `Mark ${mission.title} incomplete today` : `Complete ${mission.title} today`}>
                  <span className="quest-check">{completeToday ? <Check size={14} strokeWidth={3} /> : null}</span>
                  <span><strong>{mission.title}</strong><small>DAILY · {mission.category} · {totalClears} clear{totalClears === 1 ? '' : 's'}</small></span>
                </button>
                <i>+{mission.xp} XP</i>
                <button className="mission-delete" onClick={() => deleteMission(mission.id)} aria-label={`Delete ${mission.title}`}><Trash2 size={15} /></button>
              </div>
            }) : <div className="system-empty"><Target size={24} /><strong>No recurring missions yet.</strong><span>Add a daily mission to begin earning XP.</span></div>}
          </div>
          {!missionFormOpen && <button className="system-link" onClick={openMissionForm}><Plus size={16} /> Add another daily mission</button>}
        </div>
      </section>

      <section className="system-detail-grid">
        <div className="system-panel attribute-panel">
          <div className="system-panel-head"><div><span className="system-code">ATTRIBUTES</span><h2>Player statistics</h2></div><span className="unspent-points">0 POINTS AVAILABLE</span></div>
          <div className="attribute-list">
            {stats.map(({ label, value, icon: Icon }) => (
              <div className="attribute-row" key={label}>
                <span className="attribute-icon"><Icon size={18} /></span>
                <div><span>{label}</span><div className="attribute-bar"><i style={{ width: `${value}%` }} /></div></div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="system-panel system-feed-panel">
          <div className="system-panel-head"><div><span className="system-code">SYSTEM LOG</span><h2>Recent signals</h2></div><Zap size={20} /></div>
          <div className="system-feed">
            <div className="feed-item priority"><span><Trophy size={17} /></span><div><strong>Current directive</strong><p>{nextMilestone}</p></div></div>
            <div className="feed-item"><span><CheckCircle2 size={17} /></span><div><strong>Experience synchronized</strong><p>{missionClearCount} daily mission clears converted into lifetime progression.</p></div></div>
            <div className="feed-item"><span><Brain size={17} /></span><div><strong>Focus analysis</strong><p>{learningDone ? `${learningDone} learning missions reinforced your Focus attribute.` : 'Complete a Learning mission to increase Focus.'}</p></div></div>
            <div className="feed-item"><span><Shield size={17} /></span><div><strong>Persistence active</strong><p>Your progress is secured to the shared TKRowling workspace.</p></div></div>
          </div>
        </div>
      </section>
    </div>
  )
}

function TaskPage({ data, setData }) {
  const [filter, setFilter] = useState('All')
  const [dayFilter, setDayFilter] = useState('all')
  const [form, setForm] = useState({ title: '', time: '09:00', end_time: '10:00', category: 'Personal', date: localISO() })
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
    if (!form.date || !form.time || !form.end_time) {
      setFormMessage({ type: 'error', text: 'Choose a date, start time, and ending time for this task.' })
      return
    }
    if (form.end_time <= form.time) {
      setFormMessage({ type: 'error', text: 'The ending time must be later than the start time.' })
      return
    }
    const time = new Date(`2000-01-01T${form.time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const end_time = new Date(`2000-01-01T${form.end_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    setData((current) => ({ ...current, tasks: [...current.tasks, { ...form, title: form.title.trim(), time, end_time, id: crypto.randomUUID(), completed: false }] }))
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
          <label><span>Start time</span><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
          <label><span>Ending time</span><input type="time" value={form.end_time} min={form.time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></label>
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
  const scholarships = data.scholarships ?? []
  const [selectedId, setSelectedId] = useState(null)
  const [modalMode, setModalMode] = useState(null)
  const [draft, setDraft] = useState(() => ({ id: crypto.randomUUID(), name: '', provider: '', amount: '', deadline: addDays(30), notes: '', requirements: [] }))
  const [newRequirement, setNewRequirement] = useState('')
  const scholarship = scholarships.find((item) => item.id === selectedId)

  useEffect(() => {
    if (selectedId && !scholarship) setSelectedId(null)
  }, [selectedId, scholarship])

  const progressFor = (item) => {
    const complete = item.requirements.filter((requirement) => requirement.done).length
    return item.requirements.length ? Math.round((complete / item.requirements.length) * 100) : 0
  }
  const updateScholarship = (id, update) => setData((current) => ({
    ...current,
    scholarships: (current.scholarships ?? []).map((item) => item.id === id ? update(item) : item),
  }))
  const openAdd = () => {
    setDraft({ id: crypto.randomUUID(), name: '', provider: '', amount: '', deadline: addDays(30), notes: '', requirements: [] })
    setModalMode('add')
  }
  const openEdit = () => {
    setDraft({ ...scholarship, requirements: [...scholarship.requirements] })
    setModalMode('edit')
  }
  const toggleRequirement = (id) => updateScholarship(selectedId, (current) => ({
    ...current,
    requirements: current.requirements.map((item) => item.id === id ? { ...item, done: !item.done } : item),
  }))
  const deleteRequirement = (id) => updateScholarship(selectedId, (current) => ({
    ...current,
    requirements: current.requirements.filter((item) => item.id !== id),
  }))
  const addRequirement = (event) => {
    event.preventDefault()
    if (!newRequirement.trim() || !scholarship) return
    updateScholarship(selectedId, (current) => ({
      ...current,
      requirements: [...current.requirements, { id: crypto.randomUUID(), title: newRequirement.trim(), done: false }],
    }))
    setNewRequirement('')
  }
  const saveDetails = (event) => {
    event.preventDefault()
    const saved = { ...draft, name: draft.name.trim(), provider: draft.provider.trim(), amount: draft.amount.trim(), notes: draft.notes.trim() }
    if (modalMode === 'add') {
      setData((current) => ({ ...current, scholarships: [...(current.scholarships ?? []), saved] }))
      setSelectedId(saved.id)
    } else {
      updateScholarship(saved.id, () => saved)
    }
    setModalMode(null)
  }

  if (!scholarship) {
    const completedApplications = scholarships.filter((item) => progressFor(item) === 100 && item.requirements.length).length
    const openRequirements = scholarships.reduce((total, item) => total + item.requirements.filter((requirement) => !requirement.done).length, 0)
    return (
      <div className="page-stack inner-page scholarship-index-page">
        <section className="page-intro scholarship-index-intro">
          <div><p className="eyebrow"><span /> SCHOLARSHIP PORTFOLIO</p><h1>Build every application in one place.</h1><p>Add scholarships from Japan, Korea, or anywhere else, then track each application separately.</p></div>
          <button className="primary-button add-scholarship-button" onClick={openAdd}><Plus size={18} /> Add scholarship</button>
        </section>

        <div className="stats-row scholarship-stats">
          <StatCard icon={Award} label="Applications" value={scholarships.length} helper="Tracked separately" tone="coral" />
          <StatCard icon={CheckCircle2} label="Ready to submit" value={completedApplications} helper="All requirements done" tone="green" />
          <StatCard icon={Target} label="Open requirements" value={openRequirements} helper="Across all scholarships" tone="purple" />
        </div>

        {scholarships.length ? <section className="scholarship-portfolio-grid">
          {scholarships.map((item) => {
            const done = item.requirements.filter((requirement) => requirement.done).length
            const progress = progressFor(item)
            return <button className="card scholarship-portfolio-card" key={item.id} onClick={() => setSelectedId(item.id)}>
              <div className="scholarship-card-head"><span className="scholarship-mark"><Award size={24} /></span><span className={`application-status ${progress === 100 && item.requirements.length ? 'ready' : ''}`}>{progress === 100 && item.requirements.length ? 'READY' : 'IN PROGRESS'}</span></div>
              <span className="card-kicker">APPLICATION</span>
              <h2>{item.name}</h2>
              <p>{item.provider || 'Provider not added yet'}</p>
              <div className="scholarship-card-meta"><span><CalendarDays size={15} /> {formatDate(item.deadline, { year: 'numeric' })}</span><strong>{item.amount || 'Award TBD'}</strong></div>
              <div className="progress-line large"><i style={{ width: `${progress}%` }} /></div>
              <div className="scholarship-card-footer"><span>{done} of {item.requirements.length} requirements · {progress}%</span><strong>Open application <ChevronRight size={16} /></strong></div>
            </button>
          })}
        </section> : <div className="card scholarship-empty"><Award size={30} /><h2>No scholarships yet</h2><p>Add your first scholarship and give it its own application workspace.</p><button className="primary-button" onClick={openAdd}><Plus size={17} /> Add scholarship</button></div>}

        {modalMode === 'add' && <ScholarshipModal mode="add" draft={draft} setDraft={setDraft} onClose={() => setModalMode(null)} onSave={saveDetails} />}
      </div>
    )
  }

  const done = scholarship.requirements.filter((item) => item.done).length
  const progress = progressFor(scholarship)

  return (
    <div className="page-stack inner-page">
      <button className="scholarship-back" onClick={() => { setSelectedId(null); setNewRequirement('') }}><ChevronLeft size={17} /> All scholarships</button>
      <PageIntro eyebrow="APPLICATION WORKSPACE" title={scholarship.name} text="Track this scholarship independently from every other application." icon={Award} />
      <section className="scholarship-hero card">
        <div className="scholarship-main">
          <span className="scholarship-mark"><Award size={29} /></span>
          <div><span className="card-kicker">ACTIVE APPLICATION</span><h2>{scholarship.name}</h2><p>{scholarship.provider}</p></div>
        </div>
        <div className="deadline-display"><span>Deadline</span><strong>{formatDate(scholarship.deadline, { year: 'numeric' })}</strong><small>{daysUntil(scholarship.deadline)} days remaining</small></div>
        <div className="amount-display"><span>Award</span><strong>{scholarship.amount}</strong><small>Potential funding</small></div>
        <button className="secondary-button" onClick={openEdit}><Edit3 size={16} /> Edit details</button>
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
          <form className="inline-add" onSubmit={addRequirement}><input value={newRequirement} onChange={(e) => setNewRequirement(e.target.value)} placeholder="Add a requirement for this scholarship..." /><button><Plus size={17} /> Add requirement</button></form>
        </div>
        <div className="side-column">
          <div className="card detail-card"><span className="detail-icon"><FileText size={20} /></span><div><span className="card-kicker">ABOUT THIS SCHOLARSHIP</span><h3>Important details</h3><p>{scholarship.notes}</p></div></div>
          <div className="card countdown-card"><div><span className="card-kicker">TIME REMAINING</span><strong>{daysUntil(scholarship.deadline)}</strong><span>days</span></div><div className="calendar-graphic"><CalendarDays size={25} /><span>{formatDate(scholarship.deadline)}</span></div></div>
          <div className="motivation-card"><Sparkles size={21} /><div><strong>You’re making progress.</strong><span>Complete one small step today.</span></div></div>
        </div>
      </section>

      {modalMode === 'edit' && <ScholarshipModal mode="edit" draft={draft} setDraft={setDraft} onClose={() => setModalMode(null)} onSave={saveDetails} />}
    </div>
  )
}

function ScholarshipModal({ mode, draft, setDraft, onClose, onSave }) {
  return <Modal title={mode === 'add' ? 'Add a scholarship' : 'Edit scholarship details'} onClose={onClose}>
    <form className="modal-form" onSubmit={onSave}>
      <label><span>Scholarship name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Japan MEXT Scholarship" required /></label>
      <label><span>Provider or country</span><input value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} placeholder="e.g. Government of Japan" /></label>
      <div className="form-row"><label><span>Award amount</span><input value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="e.g. Full tuition" /></label><label><span>Deadline</span><input type="date" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} required /></label></div>
      <label><span>Details & eligibility</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows="4" placeholder="Add eligibility, documents, links, or important notes..." /></label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{mode === 'add' ? 'Create scholarship' : 'Save changes'}</button></div>
    </form>
  </Modal>
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
  const [page, setPage] = useState('system')
  const [menuOpen, setMenuOpen] = useState(false)
  const [data, setData, apiStatus, retryApi] = useDashboardData()
  const titles = { system: 'Ascension system', daily: 'Daily activities', scholarship: 'Scholarship', weight: 'Weight loss', wellness: 'Gym & meals' }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} open={menuOpen} setOpen={setMenuOpen} scholarshipCount={(data.scholarships ?? []).length} />
      <main className="main-area">
        <Topbar title={titles[page]} onMenu={() => setMenuOpen(true)} apiStatus={apiStatus} onRetry={retryApi} data={data} />
        <div className="page-content">
          {page === 'system' && <SystemPage data={data} setData={setData} />}
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
