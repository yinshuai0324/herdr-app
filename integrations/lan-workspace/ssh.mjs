import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { Client } from 'ssh2'

const input = process.stdin
const output = process.stdout

export function endpoint(config) {
  const host = config.host?.trim()
  const username = config.username?.trim()
  const port = Number(config.port || 22)
  if (!isIP(host || '') || !/^[a-zA-Z0-9._-]{1,64}$/.test(username || '') ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('请输入有效的远端 IP、SSH 用户名和端口。')
  }
  return { host, username, port, key: digest(JSON.stringify([host, port, username])) }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function question(prompt, signal, echo = true) {
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const editor = createInterface({ input, output: echo ? output : muted, terminal: true })
  const interrupt = new AbortController()
  editor.once('SIGINT', () => interrupt.abort())
  editor.once('close', () => interrupt.abort())
  if (!echo) output.write(prompt)
  try {
    return await editor.question(echo ? prompt : '', { signal: AbortSignal.any([signal, interrupt.signal]) })
  } finally {
    editor.close()
    input.pause()
    if (!echo) output.write('\n')
  }
}

async function readPin(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function verifyHost(stateDir, target, rawKey, signal) {
  const fingerprint = 'SHA256:' + createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '')
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const file = join(stateDir, target.key + '.json')
  const stored = await readPin(file)
  if (!stored) {
    const answer = await question(
      `首次连接 ${target.host}:${target.port}\nSSH 指纹 ${fingerprint}\n确认是你的远端主机后输入 yes：`,
      signal
    )
    if (answer.trim() !== 'yes') throw new Error('已取消 SSH 主机验证。')
    try {
      await writeFile(file, JSON.stringify({ fingerprint }), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  if ((await readPin(file))?.fingerprint !== fingerprint) {
    throw new Error(`SSH 主机指纹已变更（当前 ${fingerprint}）。请通过远端电脑核对后再更新信任记录。`)
  }
  return digest(target.key + ':' + fingerprint)
}

function keychain(binary, action, identity, password) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [action, identity], { stdio: ['pipe', 'pipe', 'ignore'] })
    let value = ''
    child.stdout.setEncoding('utf8').on('data', (data) => { value += data })
    child.on('error', reject)
    child.stdin.on('error', () => {})
    child.once('close', (code) => {
      if (code === 0) resolve(value)
      else if (action === 'get' && code === 3) resolve(null)
      else reject(new Error('macOS 钥匙串操作失败。'))
    })
    child.stdin.end(password)
  })
}

export function connectSsh(config, target, parentSignal) {
  const client = new Client()
  const lifetime = new AbortController()
  const signal = AbortSignal.any([parentSignal, lifetime.signal])
  let identity
  let saved = null
  let triedSaved = false
  let attemptPassword = null
  let directTries = 0
  let keyboardTries = 0
  let failure

  const fail = (error, done) => {
    failure ??= error
    done(false)
  }
  const passwordPrompt = async () => {
    if (saved !== null && !triedSaved) {
      triedSaved = true
      return saved
    }
    if (triedSaved && saved !== null) {
      await keychain(config.keychain, 'forget', identity).catch(() => {})
      saved = null
      output.write('已保存的 SSH 密码未通过验证，请重新输入。\n')
    }
    const typed = await question(`${target.username}@${target.host} 的 SSH 密码：`, signal, false)
    if (!typed) throw new Error('未输入 SSH 密码。')
    attemptPassword = typed
    return typed
  }

  return new Promise((resolve, reject) => {
    const stop = () => client.destroy()
    signal.addEventListener('abort', stop, { once: true })
    client.on('error', (error) => {
      failure ??= error
    })
    client.once('close', () => {
      signal.removeEventListener('abort', stop)
      lifetime.abort()
      reject(failure || new Error('SSH 连接已关闭。'))
    })
    client.once('ready', async () => {
      if (config.remember && attemptPassword !== null) {
        await keychain(config.keychain, 'save', identity, attemptPassword).catch((error) => {
          output.write(error.message + '\n')
        })
      }
      attemptPassword = null
      saved = null
      if (signal.aborted) {
        reject(signal.reason)
      } else {
        resolve(client)
      }
    })
    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      tryKeyboard: true,
      readyTimeout: 180_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 2,
      hostVerifier(rawKey, accept) {
        verifyHost(config.stateDir, target, rawKey, signal).then(async (credentialId) => {
          if (identity === undefined) {
            identity = credentialId
            saved = await keychain(config.keychain, 'get', identity).catch(() => null)
          }
          accept(!signal.aborted)
        }, (error) => fail(error, accept))
      },
      authHandler(methods, partialSuccess, next) {
        if (!methods) return next('none')
        if (methods.includes('password') && directTries < (triedSaved ? 3 : 2)) {
          directTries += 1
          return void passwordPrompt().then(
            (password) => next({ type: 'password', username: target.username, password }),
            (error) => fail(error, next)
          )
        }
        if (!methods.includes('keyboard-interactive') || keyboardTries++ >= 2) return next(false)
        if (!partialSuccess) attemptPassword = null
        next({
          type: 'keyboard-interactive',
          username: target.username,
          async prompt(_name, _instructions, _language, prompts, done) {
            try {
              const answers = []
              for (const { prompt, echo } of prompts.slice(0, 8)) {
                if (prompts.length === 1 && !echo && /\bpassword\b/i.test(prompt)) {
                  answers.push(await passwordPrompt())
                } else {
                  const text = String(prompt).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 160)
                  answers.push(await question(text + ' ', signal, echo))
                }
              }
              done(answers)
            } catch (error) {
              failure ??= error
              done([])
              client.end()
            }
          }
        })
      }
    })
  })
}
