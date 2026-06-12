import { homedir } from 'os'
import { isAbsolute, join, normalize, resolve } from 'path'

export function isWindows(): boolean {
    return process.platform === 'win32'
}

export function posixPathToWindowsPath(filePath: string): string {
    const match = filePath.match(/^\/([a-zA-Z])(?:\/(.*))?$/)

    if (!match) {
        return filePath
    }

    const drive = match[1].toUpperCase()
    const rest = match[2] ?? ''

    return `${drive}:\\${rest.replace(/\//g, '\\')}`
}

export function expandPath(filePath: string, baseDir = process.cwd()): string {
    if (typeof filePath !== 'string') {
        throw new TypeError(`Path must be a string, received ${typeof filePath}`)
    }

    if (typeof baseDir !== 'string') {
        throw new TypeError(`Base directory must be a string, received ${typeof baseDir}`)
    }

    if (filePath.includes('\0') || baseDir.includes('\0')) {
        throw new Error('Path contains null bytes')
    }

    const trimmedPath = filePath.trim()

    if (!trimmedPath) {
        return normalize(baseDir).normalize('NFC')
    }

    if (trimmedPath === '~') {
        return homedir().normalize('NFC')
    }

    if (trimmedPath.startsWith('~/')) {
        return normalize(join(homedir(), trimmedPath.slice(2))).normalize('NFC')
    }

    let processedPath = trimmedPath

    if (isWindows() && /^\/[a-zA-Z](?:\/|$)/.test(processedPath)) {
        processedPath = posixPathToWindowsPath(processedPath)
    }

    if (isAbsolute(processedPath)) {
        return normalize(processedPath).normalize('NFC')
    }

    return resolve(baseDir, processedPath).normalize('NFC')
}