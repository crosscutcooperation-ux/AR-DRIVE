import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { Archive, ChevronRight, File, Folder, FolderPlus, HardDrive, LayoutGrid, LogOut, MoreHorizontal, Plus, RotateCcw, Search, Star, Trash2, Upload, Users, X } from 'lucide-react'
import { api, type AdminUser, type FileItem, type Folder as FolderItem, type ShareRecord, type User } from './services/api'
import './dashboard.css'
import './drop.css'
import './menus.css'

type View = 'drive' | 'recent' | 'starred' | 'shared' | 'sharing' | 'trash' | 'admin'
type UploadJob = { id: string; name: string; file: File; percent: number; status: 'queued' | 'uploading' | 'complete' | 'failed' }

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<View>('drive')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState<FolderItem | null>(null)
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminSearch, setAdminSearch] = useState('')
  const [ownedShares, setOwnedShares] = useState<ShareRecord[]>([])
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ files: FileItem[]; folders: FolderItem[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [fileMenuId, setFileMenuId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)
  const [renameFileName, setRenameFileName] = useState('')
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [uploadQueue, setUploadQueue] = useState<UploadJob[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'name' | 'updatedAt'>('name')
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [moveOptions, setMoveOptions] = useState<FolderItem[]>([])
  const [moveTargetId, setMoveTargetId] = useState('')
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareEmail, setShareEmail] = useState('')
  const [sharePermission, setSharePermission] = useState<'VIEW' | 'EDIT'>('VIEW')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { api.get('/auth/me').then((result) => setUser(result.data.data.user)).catch(() => undefined).finally(() => setLoading(false)) }, [])

  const loadView = useCallback(async () => {
    setMessage('')
    try {
      if (view === 'drive') {
        const [folderResult, fileResult, detailResult] = await Promise.all([
          api.get('/folders', { params: { parentId: folderId ?? undefined } }),
          api.get('/files', { params: { folderId: folderId ?? undefined } }),
          folderId ? api.get(`/folders/${folderId}`) : Promise.resolve(null),
        ])
        setFolders(folderResult.data.data.folders)
        setFiles(fileResult.data.data.files)
        setCurrentFolder(detailResult?.data.data.folder ?? null)
      } else if (view === 'admin') {
        const result = await api.get('/users', { params: { search: adminSearch || undefined } })
        setAdminUsers(result.data.data.users)
        setFolders([])
        setFiles([])
        setCurrentFolder(null)
      } else if (view === 'sharing') {
        const result = await api.get('/shares/owned')
        setOwnedShares(result.data.data.shares)
        setFolders([])
        setFiles([])
        setCurrentFolder(null)
      } else {
        const endpoint = view === 'recent' ? '/recent' : view === 'starred' ? '/starred' : view === 'shared' ? '/shares' : '/trash'
        const result = await api.get(endpoint)
        setFolders(result.data.data.folders ?? [])
        setFiles(result.data.data.files ?? [])
        setCurrentFolder(null)
      }
    } catch { setMessage('Unable to load this workspace view.') }
  }, [adminSearch, folderId, view])

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

  async function updateOwnedShare(share: ShareRecord, permission: 'VIEW' | 'EDIT') {
    try {
      await api.patch(`/shares/${share.id}`, { permission })
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to update this share.'))
    }
  }

  async function revokeOwnedShare(share: ShareRecord) {
    try {
      await api.delete(`/shares/${share.id}`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to revoke this share.'))
    }
  }

  async function deactivateUser(adminUser: AdminUser) {
    setBusyAction('Deactivating account')
    try {
      await api.delete(`/users/${adminUser.id}`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to deactivate this account.'))
    } finally {
      setBusyAction(null)
    }
  }

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
    setBusyAction('Moving folder to trash')
    try {
      await api.delete(`/folders/${folder.id}`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to move this folder to trash.'))
    } finally {
      setBusyAction(null)
    }
  }

  function openRenameDialog(file: FileItem) {
    setFileMenuId(null)
    setRenameFileId(file.id)
    setRenameFileName(file.name)
  }

  async function renameFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameFileId || !renameFileName.trim()) return
    setBusyAction('Renaming file')
    try {
      await api.patch(`/files/${renameFileId}`, { name: renameFileName.trim() })
      setRenameFileId(null)
      setRenameFileName('')
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to rename this file.'))
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteFile(file: FileItem) {
    setFileMenuId(null)
    setBusyAction('Moving file to trash')
    try {
      await api.delete(`/files/${file.id}`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to move this file to trash.'))
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteForever(id: string, type: 'file' | 'folder') {
    setFileMenuId(null)
    setFolderMenuId(null)
    setBusyAction('Deleting forever')
    try {
      await api.delete(`/trash/${id}`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, `Unable to permanently delete this ${type}.`))
    } finally {
      setBusyAction(null)
    }
  }

  async function restoreTrashItem(id: string) {
    setFileMenuId(null)
    setFolderMenuId(null)
    setBusyAction('Restoring item')
    try {
      await api.post(`/trash/${id}/restore`)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to restore this item.'))
    } finally {
      setBusyAction(null)
    }
  }

  async function uploadNext(job: UploadJob) {
    setUploadQueue((current) => current.map((item) => item.id === job.id ? { ...item, status: 'uploading', percent: 0 } : item))
    const init = await api.post('/files/upload/initiate', { name: job.file.name, mimeType: job.file.type || 'application/octet-stream', size: job.file.size, folderId })
    await api.put(init.data.data.uploadPath, job.file, {
      headers: { 'Content-Type': job.file.type || 'application/octet-stream' },
      onUploadProgress: (event) => {
        if (event.total) {
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadQueue((current) => current.map((item) => item.id === job.id ? { ...item, percent } : item))
        }
      },
    })
    await api.post('/files/upload/finalize', { sessionId: init.data.data.sessionId })
    setUploadQueue((current) => current.map((item) => item.id === job.id ? { ...item, percent: 100, status: 'complete' } : item))
  }

  async function retryUpload(job: UploadJob) {
    try {
      await uploadNext(job)
      await loadView()
    } catch (error) {
      setUploadQueue((current) => current.map((item) => item.id === job.id ? { ...item, status: 'failed' } : item))
      setMessage(apiErrorMessage(error, `Upload of ${job.file.name} failed. Check the local storage directory and network.`))
    }
  }

  async function uploadFiles(selected: FileList | null) {
    if (!selected) return
    const jobs = Array.from(selected).map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 9)}`, name: file.name, file, percent: 0, status: 'queued' as const }))
    setUploadQueue(jobs)
    let uploadError = ''
    for (const job of jobs) {
      try {
        await uploadNext(job)
      } catch (error) {
        uploadError = apiErrorMessage(error, `Upload of ${job.file.name} failed. Check the local storage directory and network.`)
        setUploadQueue((current) => current.map((item) => item.id === job.id ? { ...item, status: 'failed' } : item))
      }
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

  async function openMoveDialog() {
    try {
      setMoveOptions(await loadFolderTree(null))
      setMoveTargetId('')
      setMoveDialogOpen(true)
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to load move destinations.'))
    }
  }

  async function loadFolderTree(parentId: string | null): Promise<FolderItem[]> {
    const result = await api.get('/folders', { params: { parentId: parentId ?? undefined } })
    const directFolders = result.data.data.folders as FolderItem[]
    const descendants = await Promise.all(directFolders.map((folder) => loadFolderTree(folder.id)))
    return directFolders.concat(...descendants)
  }

  async function moveSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = selectedFile ?? selectedFolder
    if (!target) return
    setBusyAction('Moving item')
    try {
      await api.patch(`${selectedFile ? '/files' : '/folders'}/${target.id}`, { [selectedFile ? 'folderId' : 'parentId']: moveTargetId || null })
      setMoveDialogOpen(false)
      setSelectedFile(null)
      setSelectedFolder(null)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to move this item.'))
    } finally {
      setBusyAction(null)
    }
  }

  async function toggleStarSelected() {
    const target = selectedFile ?? selectedFolder
    if (!target) return
    setBusyAction(view === 'starred' ? 'Removing star' : 'Adding star')
    try {
      if (view === 'starred') await api.delete(`/starred/${target.id}`)
      else await api.post(`/starred/${target.id}`)
      setSelectedFile(null)
      setSelectedFolder(null)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to update the starred state.'))
    } finally {
      setBusyAction(null)
    }
  }

  async function shareSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = selectedFile ?? selectedFolder
    if (!target || !shareEmail.trim()) return
    setBusyAction('Sharing item')
    try {
      await api.post('/shares', { ...(selectedFile ? { fileId: target.id } : { folderId: target.id }), sharedWithEmail: shareEmail.trim(), permission: sharePermission })
      setShareDialogOpen(false)
      setShareEmail('')
      setMessage('Item shared successfully.')
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to share this item.'))
    } finally {
      setBusyAction(null)
    }
  }

  async function removeSharedAccess() {
    const target = selectedFile ?? selectedFolder
    if (!target?.shareId) return
    setBusyAction('Removing access')
    try {
      await api.delete(`/shares/${target.shareId}`)
      setSelectedFile(null)
      setSelectedFolder(null)
      await loadView()
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to remove shared access.'))
    } finally {
      setBusyAction(null)
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragging(false)
    void uploadFiles(event.dataTransfer.files)
  }

  if (loading) return <div className="loading-screen">Loading workspace...</div>
  if (!user) return <Login onLogin={login} onRegister={register} />
  const visibleFolders = [...(searchResults?.folders ?? folders)].sort((left, right) => sortBy === 'name' ? left.name.localeCompare(right.name) : right.updatedAt.localeCompare(left.updatedAt))
  const visibleFiles = [...(searchResults?.files ?? files)].sort((left, right) => sortBy === 'name' ? left.name.localeCompare(right.name) : right.updatedAt.localeCompare(left.updatedAt))

  return <BrowserRouter><div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><HardDrive size={18} /></span>AR-DRIVE</div>
      <div className="create-control"><button className="new-button" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen(!createMenuOpen)}><Plus size={17} /> New</button>{createMenuOpen && <div className="create-menu" role="menu"><button role="menuitem" onClick={() => { setCreateMenuOpen(false); setFolderDialogOpen(true) }}><FolderPlus size={16} /> New folder</button><button role="menuitem" onClick={() => { setCreateMenuOpen(false); fileInput.current?.click() }}><Upload size={16} /> Upload files</button></div>}</div>
      <nav className="side-nav" aria-label="Workspace navigation">
        <NavItem active={view === 'drive'} icon={<HardDrive size={17} />} label="My Drive" onClick={() => { setView('drive'); setFolderId(null); setSearchResults(null) }} />
        <NavItem active={view === 'shared'} icon={<Users size={17} />} label="Shared with me" onClick={() => { setView('shared'); setSearchResults(null) }} />
        <NavItem active={view === 'sharing'} icon={<Users size={17} />} label="Sharing" onClick={() => { setView('sharing'); setSearchResults(null) }} />
        <NavItem active={view === 'starred'} icon={<Star size={17} />} label="Starred" onClick={() => { setView('starred'); setSearchResults(null) }} />
        <NavItem active={view === 'recent'} icon={<Archive size={17} />} label="Recent" onClick={() => { setView('recent'); setSearchResults(null) }} />
        <NavItem active={view === 'trash'} icon={<Trash2 size={17} />} label="Trash" onClick={() => { setView('trash'); setSearchResults(null) }} />
        {user.role === 'ADMIN' && <NavItem active={view === 'admin'} icon={<Users size={17} />} label="Admin" onClick={() => { setView('admin'); setSearchResults(null) }} />}
      </nav>
      <div className="storage-card"><span>Storage</span><strong>{formatBytes(user.storageUsed)} used</strong><div className="meter"><i style={{ width: `${Math.min(100, Number(user.storageUsed) / Number(user.storageQuota) * 100)}%` }} /></div><small>of {formatBytes(user.storageQuota)}</small></div>
      <button className="logout-button" onClick={() => void logout()}><LogOut size={16} /> Sign out</button>
    </aside>
    <main className={`workspace ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
      {dragging && <div className="drop-overlay"><Upload size={28} /><strong>Drop files to upload</strong><span>Files are saved to your local AR-DRIVE storage.</span></div>}
      <header className="workspace-header"><div><p className="eyebrow">Internal workspace</p><h1>{view === 'drive' ? 'My Drive' : view === 'shared' ? 'Shared with me' : view === 'sharing' ? 'Sharing' : view[0].toUpperCase() + view.slice(1)}</h1></div><div className="user-chip"><span>{user.name.slice(0, 1).toUpperCase()}</span>{user.name}</div></header>
      {view === 'drive' && <nav className="breadcrumbs" aria-label="Breadcrumb"><button onClick={() => { setFolderId(null); setSearchResults(null) }}>My Drive</button>{currentFolder && <><ChevronRight size={14} /><span>{currentFolder.name}</span></>}</nav>}
      <div className="toolbar"><form className="search-box" onSubmit={(event) => void runSearch(event)}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your workspace" /><button type="button" onClick={() => { setSearch(''); setSearchResults(null) }} aria-label="Clear search"><X size={15} /></button></form><button className="upload-button" onClick={() => fileInput.current?.click()}><Upload size={16} /> Upload</button><input ref={fileInput} hidden type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} /></div>
      <div className="view-controls"><label>Sort <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'name' | 'updatedAt')}><option value="name">Name</option><option value="updatedAt">Recently updated</option></select></label><div className="layout-toggle" role="group" aria-label="View layout"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="Grid view"><LayoutGrid size={16} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="List view"><Archive size={16} /></button></div></div>
      {message && <div className="notice">{message}</div>}
      {(uploadQueue.length > 0 || busyAction) && <div className="operation-progress" role="status">{busyAction && <div className="operation-progress-header"><span>{busyAction}</span><strong>Working...</strong></div>}{uploadQueue.map((job) => <div className="upload-job" key={job.id}><div className="operation-progress-header"><span>{job.name}</span><div className="upload-status-row"><strong>{job.status === 'queued' ? 'Queued' : job.status === 'complete' ? 'Complete' : job.status === 'failed' ? 'Failed' : `${job.percent}%`}</strong>{job.status === 'failed' && <button className="secondary-button retry-button" type="button" onClick={() => void retryUpload(job)}>Retry</button>}</div></div><div className="operation-progress-track"><i style={{ width: `${job.percent}%` }} /></div></div>)}</div>}
      {searchResults && <div className="search-label">Search results <button onClick={() => setSearchResults(null)}>Clear</button></div>}
      {view === 'admin' && <section className="admin-panel"><div className="admin-toolbar"><h2>User administration</h2><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadView() }} placeholder="Search users" /></div><div className="admin-table">{adminUsers.map((adminUser) => <div className="admin-row" key={adminUser.id}><div><strong>{adminUser.name}</strong><small>{adminUser.email}</small></div><span>{adminUser.role}</span><span>{adminUser.isActive ? 'Active' : 'Inactive'}</span>{adminUser.id !== user.id && adminUser.isActive && <button className="secondary-button" onClick={() => void deactivateUser(adminUser)}>Deactivate</button>}</div>)}</div></section>}
      {view === 'sharing' && <section className="admin-panel"><div className="admin-toolbar"><h2>Owned shares</h2></div><div className="admin-table">{ownedShares.map((share) => <div className="admin-row" key={share.id}><div><strong>{share.file?.name ?? share.folder?.name}</strong><small>{share.sharedWithUser.name} · {share.sharedWithUser.email}</small></div><select value={share.permission} onChange={(event) => void updateOwnedShare(share, event.target.value as 'VIEW' | 'EDIT')}><option value="VIEW">Can view</option><option value="EDIT">Can edit</option></select><span>{share.expiresAt ? `Expires ${formatDate(share.expiresAt)}` : 'No expiry'}</span><button className="secondary-button" onClick={() => void revokeOwnedShare(share)}>Revoke</button></div>)}</div></section>}
      {view === 'drive' && folderId && <button className="back-button" onClick={() => setFolderId(null)}>&larr; Back to root</button>}
      <div className={`content-grid ${layout === 'list' ? 'list-layout' : ''}`}>{visibleFolders.map((folder) => <article className="item-card folder-item" key={folder.id} onClick={() => { setSelectedFolder(folder); setSelectedFile(null) }}><button className="folder-open" onDoubleClick={() => { setView('drive'); setFolderId(folder.id); setSearchResults(null) }}><Folder size={27} /><span>{folder.name}</span><small>Folder</small></button><button className="folder-menu-trigger" aria-label={`Actions for ${folder.name}`} aria-expanded={folderMenuId === folder.id} onClick={() => setFolderMenuId(folderMenuId === folder.id ? null : folder.id)}><MoreHorizontal size={18} /></button>{folderMenuId === folder.id && <div className="folder-menu" role="menu">{view === 'trash' ? <><button role="menuitem" onClick={() => void restoreTrashItem(folder.id)}><RotateCcw size={15} /> Restore</button><button role="menuitem" onClick={() => void deleteForever(folder.id, 'folder')}><Trash2 size={15} /> Delete forever</button></> : <button role="menuitem" onClick={() => void deleteFolder(folder)}><Trash2 size={15} /> Move to trash</button>}</div>}</article>)}{visibleFiles.map((file) => <article className="item-card file-item" key={file.id} onClick={() => { setSelectedFile(file); setSelectedFolder(null) }}><button className="file-open" onClick={() => setPreviewFile(file)} onDoubleClick={() => void openFile(file)}>{isImage(file) ? <img className="file-thumb" src={previewUrl(file)} alt="" /> : <File size={27} />}<span>{file.name}</span><small>{formatBytes(file.size)}</small></button><button className="file-menu-trigger" aria-label={`Actions for ${file.name}`} aria-expanded={fileMenuId === file.id} onClick={() => setFileMenuId(fileMenuId === file.id ? null : file.id)}><MoreHorizontal size={18} /></button>{fileMenuId === file.id && <div className="file-menu folder-menu" role="menu">{view === 'trash' ? <><button role="menuitem" onClick={() => void restoreTrashItem(file.id)}><RotateCcw size={15} /> Restore</button><button role="menuitem" onClick={() => void deleteForever(file.id, 'file')}><Trash2 size={15} /> Delete forever</button></> : <><button role="menuitem" onClick={() => openRenameDialog(file)}>Rename</button><button role="menuitem" onClick={() => void deleteFile(file)}><Trash2 size={15} /> Move to trash</button></>}</div>}</article>)}</div>
      {(selectedFile || selectedFolder) && <aside className="details-panel"><button className="details-close" aria-label="Close details" onClick={() => { setSelectedFile(null); setSelectedFolder(null) }}><X size={17} /></button>{selectedFile ? <><File size={30} /><h2>{selectedFile.name}</h2><dl><dt>Type</dt><dd>{selectedFile.mimeType}</dd><dt>Size</dt><dd>{formatBytes(selectedFile.size)}</dd><dt>Modified</dt><dd>{formatDate(selectedFile.updatedAt)}</dd></dl></> : <><Folder size={30} /><h2>{selectedFolder?.name}</h2><dl><dt>Type</dt><dd>Folder</dd><dt>Modified</dt><dd>{formatDate(selectedFolder?.updatedAt ?? '')}</dd></dl></>} {view === 'shared' ? <button className="secondary-button details-move" onClick={() => void removeSharedAccess()}>Remove access</button> : view !== 'trash' && <><button className="secondary-button details-move" onClick={() => void openMoveDialog()}>Move</button><button className="secondary-button details-move" onClick={() => void toggleStarSelected()}><Star size={15} /> {view === 'starred' ? 'Unstar' : 'Star'}</button><button className="secondary-button details-move" onClick={() => setShareDialogOpen(true)}><Users size={15} /> Share</button></>}</aside>}
      {!visibleFolders.length && !visibleFiles.length && <div className="empty-state"><LayoutGrid size={28} /><strong>Nothing here yet</strong><span>Create a folder or upload a file to get started.</span></div>}
    </main>
    {folderDialogOpen && <div className="dialog-backdrop"><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title"><button className="dialog-close" aria-label="Close" onClick={() => setFolderDialogOpen(false)}><X size={18} /></button><p className="eyebrow">My Drive</p><h2 id="folder-dialog-title">Create a folder</h2><form onSubmit={(event) => void createFolder(event)}><label htmlFor="new-folder-name">Folder name</label><input id="new-folder-name" autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={120} required /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setFolderDialogOpen(false)}>Cancel</button><button type="submit" className="primary-button">Create folder</button></div></form></section></div>}
    {renameFileId && <div className="dialog-backdrop"><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-file-title"><button className="dialog-close" aria-label="Close" onClick={() => setRenameFileId(null)}><X size={18} /></button><p className="eyebrow">File actions</p><h2 id="rename-file-title">Rename file</h2><form onSubmit={(event) => void renameFile(event)}><label htmlFor="rename-file-name">File name</label><input id="rename-file-name" autoFocus value={renameFileName} onChange={(event) => setRenameFileName(event.target.value)} maxLength={255} required /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setRenameFileId(null)} disabled={Boolean(busyAction)}>Cancel</button><button type="submit" className="primary-button" disabled={Boolean(busyAction)}>{busyAction ?? 'Save name'}</button></div></form></section></div>}
    {moveDialogOpen && <div className="dialog-backdrop"><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title"><button className="dialog-close" aria-label="Close" onClick={() => setMoveDialogOpen(false)}><X size={18} /></button><p className="eyebrow">Organize workspace</p><h2 id="move-dialog-title">Move item</h2><form onSubmit={(event) => void moveSelected(event)}><label htmlFor="move-target">Destination</label><select id="move-target" value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)}><option value="">My Drive</option>{moveOptions.filter((folder) => folder.id !== selectedFolder?.id).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setMoveDialogOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={Boolean(busyAction)}>Move</button></div></form></section></div>}
    {shareDialogOpen && <div className="dialog-backdrop"><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title"><button className="dialog-close" aria-label="Close" onClick={() => setShareDialogOpen(false)}><X size={18} /></button><p className="eyebrow">Access control</p><h2 id="share-dialog-title">Share item</h2><form onSubmit={(event) => void shareSelected(event)}><label htmlFor="share-email">Recipient email</label><input id="share-email" type="email" autoFocus value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} required /><label htmlFor="share-permission">Permission</label><select id="share-permission" value={sharePermission} onChange={(event) => setSharePermission(event.target.value as 'VIEW' | 'EDIT')}><option value="VIEW">Can view</option><option value="EDIT">Can edit</option></select><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setShareDialogOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={Boolean(busyAction)}>Share</button></div></form></section></div>}
    {previewFile && <PreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />}
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
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString() }
function apiErrorMessage(error: unknown, fallback: string) { return (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? fallback }
function previewUrl(file: FileItem) { return `${api.defaults.baseURL}/files/${file.id}/preview` }
function isImage(file: FileItem) { return file.mimeType.startsWith('image/') }

function PreviewDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const url = previewUrl(file)
  const content = file.mimeType.startsWith('image/') ? <img className="preview-media" src={url} alt={file.name} /> : file.mimeType === 'application/pdf' ? <iframe className="preview-frame" src={url} title={file.name} /> : file.mimeType.startsWith('video/') ? <video className="preview-media" src={url} controls /> : file.mimeType.startsWith('audio/') ? <audio src={url} controls /> : <div className="preview-unavailable">Preview unavailable for this file type.<br />Double-click the file to download it.</div>
  return <div className="dialog-backdrop" onClick={onClose}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={(event) => event.stopPropagation()}><button className="dialog-close" aria-label="Close preview" onClick={onClose}><X size={18} /></button><h2 id="preview-title">{file.name}</h2>{content}</section></div>
}

export default App
