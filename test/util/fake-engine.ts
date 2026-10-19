import type { EngineInterface, FsEntry } from 'claude-code'

export type FakeEngineTree = {
  /** File contents by real path. Mutable: a test can change it mid-way. */
  files: Record<string, string>
  /** Symlink targets (directories) by link path. */
  links?: Record<string, string>
  /** Paths that exist but can't be read. */
  unreadable?: string[]
}

/** A `$` for unit tests: `fs`, `store` and `session.id`, in memory. */
export type FakeEngine = {
  $: EngineInterface
  /** The store, live. */
  store: Map<string, unknown>
  /** Every path read, in order. */
  reads: string[]
  /** Switches the session the store records are kept under. */
  setSession: (id: string) => void
}

/**
 * Builds the slice of `$` that `src/core` and `src/state` call, for unit tests
 * of those modules on their own. The consumer tests use the real engine.
 */
export function fakeEngine(tree: FakeEngineTree = { files: {} }, stored: Record<string, unknown> = {}): FakeEngine {
  const store = new Map(Object.entries(stored))
  const reads: string[] = []
  let sessionId = 's1'
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

  const $ = {
    session: { id: async () => sessionId },
    store: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
      keys: async () => [...store.keys()],
    },
    fs: {
      list: async (path: string) => {
        const dir = realOf(path)
        if (kindOf(dir) !== 'dir') {
          throw missing(path)
        }

        const names = new Set(known().filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0] ?? ''))

        return [...names].map((name): FsEntry => {
          const child = `${dir}/${name}`
          const isLink = child in links()
          return { name, kind: isLink ? 'other' : (kindOf(child) ?? 'other'), ...stampOf(child), isLink }
        })
      },
      stat: async (path: string) => {
        const real = realOf(path)
        const kind = kindOf(real)
        if (kind === undefined) {
          throw missing(path)
        }

        return { kind, ...stampOf(real), isLink: path in links(), realPath: real }
      },
      read: async (path: string) => {
        reads.push(path)
        const text = tree.files[realOf(path)]
        if (text === undefined) {
          throw missing(path)
        }

        return text
      },
    },
  }

  return { $: $ as unknown as EngineInterface, store, reads, setSession: id => void (sessionId = id) }
}
