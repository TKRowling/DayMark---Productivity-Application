import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const virtualEnvPython = process.platform === 'win32'
  ? '.venv\\Scripts\\python.exe'
  : '.venv/bin/python'

const fallbackPython = process.platform === 'win32' ? 'python' : 'python3'
const python = existsSync(virtualEnvPython) ? virtualEnvPython : fallbackPython

const api = spawn(
  python,
  ['-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--reload', '--port', '8000'],
  { stdio: 'inherit' },
)

api.on('error', (error) => {
  console.error(`Could not start FastAPI with ${python}: ${error.message}`)
  console.error('Create the virtual environment and install backend/requirements.txt, then try again.')
  process.exit(1)
})

api.on('exit', (code) => process.exit(code ?? 0))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => api.kill(signal))
}
