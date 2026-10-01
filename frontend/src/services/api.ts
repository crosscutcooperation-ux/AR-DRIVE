import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:4000/api`,
  withCredentials: true,
})

let isRefreshing = false
let refreshQueue: Array<{
  resolve: (value?: unknown) => void
  reject: (reason?: unknown) => void
}> = []

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: () => resolve(api(originalRequest)),
          reject: (reason) => reject(reason),
        })
      })
    }

    isRefreshing = true
    originalRequest._retry = true

    try {
      await api.post('/auth/refresh')
      isRefreshing = false

      refreshQueue.forEach(({ resolve }) => resolve())
      refreshQueue = []

      return api(originalRequest)
    } catch (refreshError) {
      isRefreshing = false
      refreshQueue.forEach(({ reject }) => reject(refreshError))
      refreshQueue = []
      window.location.href = '/'
      return Promise.reject(refreshError)
    }
  },
)

export type User = { id: string; name: string; email: string; role: 'ADMIN' | 'USER'; storageQuota: string; storageUsed: string }
export type Folder = { id: string; name: string; parentId: string | null; updatedAt: string; shareId?: string; permission?: 'VIEW' | 'EDIT' }
export type FileItem = { id: string; name: string; originalName: string; mimeType: string; size: string; folderId: string | null; updatedAt: string; createdAt: string; shareId?: string; permission?: 'VIEW' | 'EDIT' }
export type AdminUser = { id: string; name: string; email: string; role: 'ADMIN' | 'USER'; storageQuota: string; storageUsed: string; isActive: boolean; createdAt: string }
export type ShareRecord = { id: string; permission: 'VIEW' | 'EDIT'; expiresAt: string | null; file: { id: string; name: string } | null; folder: { id: string; name: string } | null; sharedWithUser: { id: string; name: string; email: string } }
