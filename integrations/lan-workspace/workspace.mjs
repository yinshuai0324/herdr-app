import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { LanSmbMount } from './lan-smb-mount.mjs'
import { LocalPreview } from './local-preview.mjs'
import { connectSsh, endpoint } from './ssh.mjs'

const exec = promisify(execFile)
const input = process.stdin
const output = process.stdout

async function projectConfig(config) {
  if (!isAbsolute(config.directory)) throw new Error('请选择本机项目目录。')
  const directory = await realpath(config.directory)
  if (directory === '/' || !(await stat(directory)).isDirectory()) {
    throw new Error('请选择本机项目目录。')
  }
  const startCommand = config.startCommand.trim()
  const previewUrl = config.previewUrl.trim()
  if (!startCommand || !previewUrl) return { directory }
  const url = URL.parse(previewUrl)
  if (!url || !['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('预览地址须为这台 Mac 的本地 HTTP 或 HTTPS 地址。')
  }
  return { directory, startCommand, url: url.href }
}

function runRemote(client, command) {
  return new Promise((resolve, reject) => {
    let stream
    let stdout = ''
    const timeout = setTimeout(() => {
      stream?.destroy()
      reject(new Error('远端检查超时。'))
    }, 10_000)
    const failed = (error) => {
      clearTimeout(timeout)
      reject(error)
    }
    client.exec(command, (error, channel) => {
      if (error) return failed(error)
      stream = channel
      channel.on('data', (chunk) => { stdout = (stdout + chunk).slice(-2048) })
      channel.stderr.resume()
      channel.on('error', failed)
      channel.once('close', (code) => {
        clearTimeout(timeout)
        resolve({ code, stdout: stdout.trim() })
      })
      channel.end()
    })
  })
}

function terminalSize() {
  return { cols: output.columns || 80, rows: output.rows || 24, term: 'xterm-256color' }
}

function openTerminal(client, shellDirectory, signal) {
  return new Promise((resolve, reject) => {
    const command = `${shellDirectory} && exec "\${SHELL:-/bin/sh}" -i`
    client.exec(command, { pty: terminalSize() }, (error, channel) => {
      if (error) return reject(error)
      if (signal.aborted) {
        channel.destroy()
        return reject(signal.reason)
      }
      const resize = () => {
        const { cols, rows } = terminalSize()
        channel.setWindow(rows, cols, 0, 0)
      }
      const stop = () => channel.destroy()
      const raw = input.isRaw
      const cleanup = () => {
        signal.removeEventListener('abort', stop)
        output.off('resize', resize)
        input.unpipe(channel)
        input.setRawMode(raw)
        input.pause()
      }
      signal.addEventListener('abort', stop, { once: true })
      output.on('resize', resize)
      input.setRawMode(true)
      channel.pipe(output, { end: false })
      channel.stderr.pipe(process.stderr, { end: false })
      channel.on('error', (streamError) => {
        cleanup()
        reject(streamError)
      })
      channel.once('close', (code) => {
        cleanup()
        if (signal.aborted) reject(signal.reason)
        else resolve(Number.isInteger(code) ? code : 0)
      })
      input.pipe(channel)
    })
  })
}

export async function runWorkspace(config, openPreview = (url) => exec('/usr/bin/open', [url])) {
  if (process.platform !== 'darwin' || !input.isTTY || !output.isTTY) {
    throw new Error('请在本机 Mac 的 Herdr 终端工作区启动。')
  }
  const controller = new AbortController()
  const signal = controller.signal
  const cancel = () => controller.abort(new Error('连接已取消。'))
  const stopOnHangup = () => controller.abort(new Error('SSH 连接已断开。'))
  const project = await projectConfig(config)
  const target = endpoint(config)
  for (const name of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.once(name, cancel)
  const preview = project.url
    ? new LocalPreview(project, openPreview, (text) => {
        // Project output must not take over the interactive remote terminal.
        previewLog = (previewLog + text).slice(-4096)
      })
    : null
  let previewLog = ''
  let previewStarted = false
  let client
  let mount
  try {
    output.write(`连接 ${target.username}@${target.host}…\n`)
    client = await connectSsh(config, target, signal)
    client.once('close', stopOnHangup)
    const remotePlatform = await runRemote(client, '/usr/bin/uname -s')
    if (remotePlatform.code !== 0 || remotePlatform.stdout.split('\n').at(-1) !== 'Darwin') {
      throw new Error('共享目录工作区目前需要远端 Mac。')
    }
    output.write('挂载本机项目…\n')
    mount = new LanSmbMount(client, (command) => runRemote(client, command), () => {
      if (!preview || previewStarted || signal.aborted) return
      previewStarted = true
      void preview.open().catch((error) => {
        if (!signal.aborted) {
          const detail = previewLog.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(-500)
          process.stderr.write(`\r\n本机预览失败：${error.message}${detail ? '\r\n' + detail : ''}\r\n`)
        }
      })
    }, () => controller.abort(new Error('SMB 挂载已断开。')), config.smbServer)
    await mount.open(project.directory)
    signal.throwIfAborted()
    output.write('共享目录已挂载。现在可运行远端已有的 CLI。\n')
    return await openTerminal(client, mount.shellDirectory, signal)
  } finally {
    preview?.close()
    client?.off('close', stopOnHangup)
    await mount?.close()
    client?.end()
    for (const name of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.off(name, cancel)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runWorkspace(JSON.parse(process.argv[2]))
  } catch (error) {
    process.stderr.write(`\r\n${String(error.message ?? error).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')}\r\n`)
    process.exitCode = 1
  }
}
