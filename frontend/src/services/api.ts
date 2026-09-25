import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:4000/api`,
  withCredentials: true,
})

export type User = { id: string; name: string; email: string; role: 'ADMIN' | 'USER'; storageQuota: string; storageUsed: string }
export type Folder = { id: string; name: string; parentId: string | null; updatedAt: string }
export type FileItem = { id: string; name: string; originalName: string; mimeType: string; size: string; folderId: string | null; updatedAt: string; createdAt: string }
