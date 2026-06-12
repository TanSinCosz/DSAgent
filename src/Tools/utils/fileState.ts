import { stat } from 'fs/promises'

export async function getFileModificationTimeAsync(filePath: string): Promise<number> {
    const stats = await stat(filePath)
    return Math.floor(stats.mtimeMs)
}
