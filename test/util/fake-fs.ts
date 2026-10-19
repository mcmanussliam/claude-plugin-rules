import type { FsEntry, On } from 'claude-code'

export type Tree = {
  /** File contents by real path. Mutable: a test can change it mid-way. */
  files: Record<string, string>
  /** Symlink targets (directories) by link path. */
  links?: Record<string, string>
  /** Paths that exist but can't be read. */
  unreadable?: string[]
}

export type FakeOptions = {
  /** The store's entries before the test. */
  stored?: Record<string, unknown>
  /** The session's working directory; the project root is always `/repo`. */
  cwd?: string
}

/** What a test can inspect after its calls. */
export type Fake = {
  /** The store, live. */
  store: Map<string, unknown>
  /** Every path read, in order. */
  reads: string[]
}

/**
 * Answers `$.fs.*`, the session (root `/repo`, id `s1`) and `$.store` from
 * memory, reading `tree` afresh on every call.
 */
export function fakeFs(on: On, tree: Tree, options: FakeOptions = {}): Fake {
  const fake: Fake = { store: new Map(Object.entries(options.stored ?? {})), reads: [] }
  const links = () => tree.links ?? {}

  const realOf = (path: string): string => {
    for (const [link, target] of Object.entries(links())) {
      if (path === link || path.startsWith(`${link}/`)) {
        return realOf(target + path.slice(link.length))
      }
    }

    return path
  }

  const known = () => [...Object.keys(tree.files), ...Object.keys(links()), ...(tree.unreadable ?? [])]
  const kindOf = (real: string): FsEntry['kind'] | undefined =>
    real in tree.files || tree.unreadable?.includes(real)
      ? 'file'
      : known().some(p => p.startsWith(`${real}/`))
        ? 'dir'
        : undefined
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })

  /** A file's size and a modification time that changes with its content, as a real file's would. */
  const stampOf = (real: string) => {
    const text = tree.files[real] ?? ''
    let hash = 0
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return { size: text.length, mtimeMs: hash }
  }

  on('session.root', () => ({ value: '/repo' }))
  on('session.cwd', () => ({ value: options.cwd ?? '/repo' }))
  on('session.id', () => ({ value: 's1' }))

  on('store.get', ($, e) => ({ value: fake.store.get(e.key) }))
  on('store.set', ($, e) => (fake.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (fake.store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...fake.store.keys()] }))

  on('fs.list', ($, e) => {
    const dir = realOf(e.path ?? '/repo')
    const names = new Set(
      known()
        .filter(p => p.startsWith(`${dir}/`))
        .map(p => p.slice(dir.length + 1).split('/')[0] ?? ''),
    )

    return {
      value: [...names].sort().map((name): FsEntry => {
        const path = `${dir}/${name}`
        const isLink = path in links()

        return { name, kind: isLink ? 'other' : (kindOf(path) ?? 'other'), ...stampOf(path), isLink }
      }),
    }
  })

  on('fs.exists', ($, e) => ({ value: kindOf(realOf(e.path)) !== undefined }))

  on('fs.stat', ($, e) => {
    const real = realOf(e.path)
    const kind = kindOf(real)
    if (kind === undefined) {
      throw missing(e.path)
    }

    return { value: { kind, ...stampOf(real), isLink: e.path in links(), realPath: real } }
  })

  on('fs.read', ($, e) => {
    fake.reads.push(e.path)
    const text = tree.files[realOf(e.path)]
    if (text === undefined) {
      throw missing(e.path)
    }

    return { value: text }
  })

  return fake
}
