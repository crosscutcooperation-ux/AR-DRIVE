import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { Archive, ChevronRight, File, Folder, FolderPlus, HardDrive, LayoutGrid, LogOut, MoreHorizontal, Plus, Search, Star, Trash2, Upload, Users, X } from 'lucide-react'
import { api, type FileItem, type Folder as FolderItem, type User } from './services/api'
import './dashboard.css'
import './drop.css'
import './menus.css'

type View = 'drive' | 'recent' | 'starred' | 'shared' | 'trash'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<View>('drive')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ files: FileItem[]; folders: FolderItem[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { api.get('/auth/me').then((result) => setUser(result.data.data.user)).catch(() => undefined).finally(() => setLoading(false)) }, [])

  const loadView = useCallback(async () => {
    setMessage('')
    try {
      if (view === 'drive') {
        const [folderResult, fileResult] = await Promise.all([api.get('/folders', { params: { parentId: folderId ?? undefined } }), api.get('/files', { params: { folderId: folderId ?? undefined } })])
        setFolders(folderResult.data.data.folders)
        setFiles(fileResult.data.data.files)
      } else {
        const endpoint = view === 'recent' ? '/recent' : view === 'starred' ? '/starred' : view === 'shared' ? '/shares' : '/trash'
        const result = await api.get(endpoint)
        setFolders(result.data.data.folders ?? [])
        setFiles(result.data.data.files ?? [])
      }
    } catch { setMessage('Unable to load this workspace view.') }
  }, [folderId, view])

  // The effect synchronizes the current navigation selection with server state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (user) void loadView() }, [user, loadView])

  async function login(email: string, password: string) {
    const result = await api.post('/auth/login', { email, password })
    setUser(result.data.data.user)
  }

  async function register(name: string, email: string, password: string) {
    const result = await api.post('/auth/register', { name, email, password })
    setUser(result.data.data.user)
  }

  async function logout() { await api.post('/auth/logout'); setUser(null) }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name) return
    try {
      await api.post('/folders', { name, parentId: folderId })
      setFolderDialogOpen(false)
      setNewFolderName('')
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to create this folder.'))
    }
  }

  async function deleteFolder(folder: FolderItem) {
    setFolderMenuId(null)
    try {
      await api.delete(`/folders/${folder.id}`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to move this folder to trash.'))
    }
  }

  async function uploadFiles(selected: FileList | null) {
    if (!selected) return
    let uploadError = ''
    for (const file of Array.from(selected)) {
      try {
        const init = await api.post('/files/upload/initiate', { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folderId })
        await api.put(init.data.data.uploadPath, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } })
        await api.post('/files/upload/finalize', { sessionId: init.data.data.sessionId })
      } catch (error) { uploadError = apiErrorMessage(error, `Upload of ${file.name} failed. Check the S3 bucket CORS configuration and network.`) }
    }
    if (fileInput.current) fileInput.current.value = ''
    await loadView()
    if (uploadError) setMessage(uploadError)
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault()
    if (search.trim().length < 2) { setSearchResults(null); return }
    const result = await api.get('/search', { params: { q: search.trim() } })
    setSearchResults(result.data.data)
  }

  async function openFile(file: FileItem) {
    const result = await api.get(`/files/${file.id}/download`)
    window.open(result.data.data.url, '_blank', 'noopener,noreferrer')
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragging(false)
    void uploadFiles(event.dataTransfer.files)
  }

  if (loading) return <div className="loading-screen">Loading workspace...</div>
  if (!user) return <Login onLogin={login} onRegister={register} />
  const visibleFolders = searchResults?.folders ?? folders
  const visibleFiles = searchResults?.files ?? files

  return <BrowserRouter><div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><HardDrive size={18} /></span>AR-DRIVE</div>
      <div className="create-control"><button className="new-button" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen(!createMenuOpen)}><Plus size={17} /> New</button>{createMenuOpen && <div className="create-menu" role="menu"><button role="menuitem" onClick={() => { setCreateMenuOpen(false); setFolderDialogOpen(true) }}><FolderPlus size={16} /> New folder</button><button role="menuitem" onClick={() => { setCreateMenuOpen(false); fileInput.current?.click() }}><Upload size={16} /> Upload files</button></div>}</div>
      <nav className="side-nav" aria-label="Workspace navigation">
        <NavItem active={view === 'drive'} icon={<HardDrive size={17} />} label="My Drive" onClick={() => { setView('drive'); setFolderId(null); setSearchResults(null) }} />
        <NavItem active={view === 'shared'} icon={<Users size={17} />} label="Shared with me" onClick={() => { setView('shared'); setSearchResults(null) }} />
        <NavItem active={view === 'starred'} icon={<Star size={17} />} label="Starred" onClick={() => { setView('starred'); setSearchResults(null) }} />
        <NavItem active={view === 'recent'} icon={<Archive size={17} />} label="Recent" onClick={() => { setView('recent'); setSearchResults(null) }} />
        <NavItem active={view === 'trash'} icon={<Trash2 size={17} />} label="Trash" onClick={() => { setView('trash'); setSearchResults(null) }} />
      </nav>
      <div className="storage-card"><span>Storage</span><strong>{formatBytes(user.storageUsed)} used</strong><div className="meter"><i style={{ width: `${Math.min(100, Number(user.storageUsed) / Number(user.storageQuota) * 100)}%` }} /></div><small>of {formatBytes(user.storageQuota)}</small></div>
      <button className="logout-button" onClick={() => void logout()}><LogOut size={16} /> Sign out</button>
    </aside>
    <main className={`workspace ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
      {dragging && <div className="drop-overlay"><Upload size={28} /><strong>Drop files to upload</strong><span>Files go directly to secure S3 storage.</span></div>}
      <header className="workspace-header"><div><p className="eyebrow">Internal workspace</p><h1>{view === 'drive' ? 'My Drive' : view === 'shared' ? 'Shared with me' : view[0].toUpperCase() + view.slice(1)}</h1></div><div className="user-chip"><span>{user.name.slice(0, 1).toUpperCase()}</span>{user.name}</div></header>
      <div className="toolbar"><form className="search-box" onSubmit={(event) => void runSearch(event)}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your workspace" /><button type="button" onClick={() => { setSearch(''); setSearchResults(null) }} aria-label="Clear search"><X size={15} /></button></form><button className="upload-button" onClick={() => fileInput.current?.click()}><Upload size={16} /> Upload</button><input ref={fileInput} hidden type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} /></div>
      {message && <div className="notice">{message}</div>}
      {searchResults && <div className="search-label">Search results <button onClick={() => setSearchResults(null)}>Clear</button></div>}
      {view === 'drive' && folderId && <button className="back-button" onClick={() => setFolderId(null)}>&larr; Back to root</button>}
      <div className="content-grid">{visibleFolders.map((folder) => <article className="item-card folder-item" key={folder.id}><button className="folder-open" onDoubleClick={() => { setView('drive'); setFolderId(folder.id); setSearchResults(null) }}><Folder size={27} /><span>{folder.name}</span><small>Folder</small></button><button className="folder-menu-trigger" aria-label={`Actions for ${folder.name}`} aria-expanded={folderMenuId === folder.id} onClick={() => setFolderMenuId(folderMenuId === folder.id ? null : folder.id)}><MoreHorizontal size={18} /></button>{folderMenuId === folder.id && <div className="folder-menu" role="menu"><button role="menuitem" onClick={() => void deleteFolder(folder)}><Trash2 size={15} /> Move to trash</button></div>}</article>)}{visibleFiles.map((file) => <button className="item-card file-card" key={file.id} onDoubleClick={() => void openFile(file)}><File size={27} /><span>{file.name}</span><small>{formatBytes(file.size)}</small></button>)}</div>
      {!visibleFolders.length && !visibleFiles.length && <div className="empty-state"><LayoutGrid size={28} /><strong>Nothing here yet</strong><span>Create a folder or upload a file to get started.</span></div>}
    </main>
    {folderDialogOpen && <div className="dialog-backdrop"><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title"><button className="dialog-close" aria-label="Close" onClick={() => setFolderDialogOpen(false)}><X size={18} /></button><p className="eyebrow">My Drive</p><h2 id="folder-dialog-title">Create a folder</h2><form onSubmit={(event) => void createFolder(event)}><label htmlFor="new-folder-name">Folder name</label><input id="new-folder-name" autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={120} required /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setFolderDialogOpen(false)}>Cancel</button><button type="submit" className="primary-button">Create folder</button></div></form></section></div>}
  </div></BrowserRouter>
}

function Login({ onLogin, onRegister }: { onLogin: (email: string, password: string) => Promise<void>; onRegister: (name: string, email: string, password: string) => Promise<void> }) {
  const [registering, setRegistering] = useState(false); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('')
  const heading = registering ? 'Create your account.' : 'Welcome back.'
  const description = registering ? 'Set up your secure workspace account.' : 'Sign in to your secure workspace.'
  return <main className="login-screen"><div className="login-panel"><div className="brand"><span className="brand-mark"><HardDrive size={18} /></span>AR-DRIVE</div><p className="eyebrow">Company file intelligence</p><h1>{heading}</h1><p>{description}</p><form onSubmit={(event) => { event.preventDefault(); setError(''); const action = registering ? onRegister(name, email, password) : onLogin(email, password); void action.catch((cause: unknown) => { const apiMessage = (cause as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message; setError(apiMessage ?? (registering ? 'Could not reach the server. Check that the API is running and try again.' : 'Email or password is incorrect.')) }) }}>{registering && <label>Name<input type="text" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></label>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" type="submit">{registering ? 'Create account' : 'Sign in'} <ChevronRight size={17} /></button></form><button className="auth-switch" type="button" onClick={() => { setRegistering(!registering); setError('') }}>{registering ? 'Already have an account? Sign in' : 'Need an account? Create one'}</button></div></main>
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}{label}</button> }
function formatBytes(value: string) { const bytes = Number(value); if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function apiErrorMessage(error: unknown, fallback: string) { return (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? fallback }

export default App
