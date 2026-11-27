import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LanSmbMount } from './lan-smb-mount.mjs'
import { connectSsh, endpoint } from './ssh.mjs'

const input = process.stdin
const output = process.stdout

async function projectDirectory(path) {
  if (!isAbsolute(path)) throw new Error('请选择本机项目目录。')
  const directory = await realpath(path)
  if (directory === '/' || !(await stat(directory)).isDirectory()) {
    throw new Error('请选择本机项目目录。')
  }
  return directory
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

export async function runWorkspace(config) {
  if (process.platform !== 'darwin' || !input.isTTY || !output.isTTY) {
    throw new Error('请在本机 Mac 的 Herdr 终端工作区启动。')
  }
  const controller = new AbortController()
  const signal = controller.signal
  const cancel = () => controller.abort(new Error('连接已取消。'))
  const stopOnHangup = () => controller.abort(new Error('SSH 连接已断开。'))
  const directory = await projectDirectory(config.directory)
  const target = endpoint(config)
  for (const name of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.once(name, cancel)
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
    mount = new LanSmbMount(
      client,
      (command) => runRemote(client, command),
      () => controller.abort(new Error('SMB 挂载已断开。')),
      config.smbServer
    )
    await mount.open(directory)
    signal.throwIfAborted()
    output.write('共享目录已挂载。现在可运行远端已有的 CLI。\n')
    return await openTerminal(client, mount.shellDirectory, signal)
  } finally {
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
