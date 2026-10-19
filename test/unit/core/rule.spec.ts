import { describe, expect, it } from 'vitest'

import { instructionFrameOf, isMatch, nestedFrameOf, parseRule, pathsOf } from '../../../src/core/rule'
import type { Rule } from '../../../src/types'

const rule = (paths?: string[]): Rule => ({ path: '/r.md', content: '', ...(paths === undefined ? {} : { paths }) })

describe('parseRule', () => {
  it('keeps a file without frontmatter whole, with no globs', () => {
    expect(parseRule('# Rule\n\nBody\n')).toEqual({ content: '# Rule\n\nBody\n' })
  })

  it('reads a list of globs and strips the frontmatter', () => {
    expect(parseRule('---\npaths:\n  - "src/**"\n  - "lib/*.ts"\n---\n# Rule\n')).toEqual({
      paths: ['src/**', 'lib/*.ts'],
      content: '# Rule\n',
    })
  })

  it('reads a single glob given as a string', () => {
    expect(parseRule('---\npaths: src/**\n---\nBody')).toEqual({ paths: ['src/**'], content: 'Body' })
  })

  it('treats frontmatter without paths as always loaded, still stripping it', () => {
    expect(parseRule('---\ndescription: Something\n---\nBody')).toEqual({ content: 'Body' })
  })

  it('treats an empty paths list as always loaded', () => {
    expect(parseRule('---\npaths: []\n---\nBody')).toEqual({ content: 'Body' })
  })

  it('treats invalid YAML as no frontmatter data, still stripping the block', () => {
    expect(parseRule('---\npaths: [unclosed\n---\nBody')).toEqual({ content: 'Body' })
  })

  it('treats empty frontmatter as always loaded', () => {
    expect(parseRule('---\n\n---\nBody')).toEqual({ content: 'Body' })
  })

  it('reads frontmatter with Windows line endings', () => {
    expect(parseRule('---\r\npaths:\r\n  - "src/**"\r\n---\r\nBody')).toEqual({ paths: ['src/**'], content: 'Body' })
  })

  it('leaves a --- block that is not at the very start alone', () => {
    const text = '# Rule\n---\npaths: src/**\n---\n'
    expect(parseRule(text)).toEqual({ content: text })
  })

  it('treats a frontmatter value that is not a mapping as no paths', () => {
    expect(parseRule('---\njust a string\n---\nBody')).toEqual({ content: 'Body' })
  })
})

describe('pathsOf', () => {
  it('normalises a string to a list', () => {
    expect(pathsOf('src/**')).toEqual({ paths: ['src/**'] })
  })

  it('drops entries that are not strings, and empty strings', () => {
    expect(pathsOf(['src/**', 1, null, '', { a: 1 }, 'lib/**'])).toEqual({ paths: ['src/**', 'lib/**'] })
  })

  it('answers nothing when no glob is left', () => {
    expect(pathsOf(undefined)).toEqual({})
    expect(pathsOf(null)).toEqual({})
    expect(pathsOf([])).toEqual({})
    expect(pathsOf([''])).toEqual({})
    expect(pathsOf(42)).toEqual({})
  })
})

describe('isMatch', () => {
  it('matches a path against any of the globs', () => {
    expect(isMatch(rule(['lib/**', 'src/**/*.ts']), 'src/a/b.ts')).toBe(true)
  })

  it('does not match a path none of the globs cover', () => {
    expect(isMatch(rule(['src/**/*.ts']), 'src/a/b.js')).toBe(false)
    expect(isMatch(rule(['src/**/*.ts']), 'test/a.ts')).toBe(false)
  })

  it('never matches a rule without globs', () => {
    expect(isMatch(rule(), 'src/a.ts')).toBe(false)
  })

  it('matches dotfiles and dot directories', () => {
    expect(isMatch(rule(['**/*.yml']), '.github/workflows/ci.yml')).toBe(true)
    expect(isMatch(rule(['*']), '.env')).toBe(true)
  })

  it('supports braces and single-segment stars', () => {
    expect(isMatch(rule(['src/**/*.{ts,tsx}']), 'src/view.tsx')).toBe(true)
    expect(isMatch(rule(['src/*.ts']), 'src/a/b.ts')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(isMatch(rule(['src/**']), 'SRC/a.ts')).toBe(false)
  })
})

describe('instructionFrameOf', () => {
  it('frames a rule as the engine frames a user instruction file', () => {
    expect(instructionFrameOf({ path: '/p/rules/a.md', content: 'Body\n' })).toBe(
      "Contents of /p/rules/a.md (user's private global instructions for all projects):\n\nBody\n",
    )
  })
})

describe('nestedFrameOf', () => {
  it('frames a rule as the engine frames a rules file it loads for a read', () => {
    expect(nestedFrameOf({ path: '/p/rules/a.md', content: 'Body\n' })).toBe('Contents of /p/rules/a.md:\n\nBody\n')
  })
})
