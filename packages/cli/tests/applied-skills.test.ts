import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { exportSkillFolder, skillMdOf } from '../src/applied-skills'
import { genofficeDevUserDataDir, genofficeUserDataDir } from '../src/gui'
import { createContext, disposeContext } from '../src/mcp/run'
import { createMcpServer } from '../src/mcp/server'
import { run, tempDir } from './helpers'

// Follow-along (issue #558): the skills the person applied (enabled) in the
// app are exposed as ieumoffice://skills (name and description only) and
// ieumoffice://skills/<name> (one SKILL.md), and `skill export` writes an
// applied skill as a standard skill folder. What the person left off is never
// exposed — nor a hidden builtin, a builtin for the agent window only, or a
// skill another enabled skill of the same name pushed back.

const TEAM_SKILL_MD = [
  '---',
  'name: team-docs',
  'description: Turn rough notes into a shared team document.',
  'metadata:',
  '  ieum-title: Team document',
  '---',
  '',
  '# Team document',
  '',
  'Follow these steps to shape a team document.',
  '',
].join('\n')

const GRADE_SKILL_MD = [
  '---',
  'name: grade-review',
  'description: Review student records before submission.',
  '---',
  '',
  'Check each record against the checklist.',
  '',
].join('\n')

const OFF_SKILL_MD = [
  '---',
  'name: off-skill',
  'description: A skill the person turned off.',
  '---',
  '',
  'This body must never leave the machine.',
  '',
].join('\n')

const TEMPLATE_SKILL_MD = [
  '---',
  'name: template-docs',
  'description: Make a report from the saved template.',
  'metadata:',
  '  ieum-template: assets/report.docx',
  '---',
  '',
  'Open the template and fill it in.',
  '',
].join('\n')

/** the template document's bytes: the copy of a real document, a real name inside */
const TEMPLATE_DOCUMENT = 'REPORT-TEMPLATE-HOLDING-A-REAL-NAME'

/** The body markers a leaked skill would show up with */
const SHADOWED_BETA_BODY = 'BETA-SHADOWED-BODY'
const SHADOWED_BUILTIN_BODY = 'BUILTIN-SHADOWED-BODY'
const HIDDEN_BUILTIN_BODY = 'HIDDEN-BUILTIN-BODY'
const AGENT_ONLY_BODY = 'AGENT-ONLY-BUILTIN-BODY'

interface Fixture {
  home: string
  userData: string
  env: NodeJS.ProcessEnv
}

interface BuiltinSpec {
  /** the folder name and front-matter name */
  name: string
  body: string
  /** manifest flag: for the agent window only */
  agentOnly?: boolean
}

interface FixtureOptions {
  /** the `skills` value of app-settings.json (default: one skill turned off) */
  skillSettings?: unknown
  /** builtin skills, listed in the fixture's builtin-skills.json */
  builtins?: BuiltinSpec[]
  /** more app skills: the folder each lives in and its SKILL.md text */
  extraSkills?: Array<{ folder: string; md: string }>
}

function skillMd(name: string, description: string, body: string): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', '', body, ''].join('\n')
}

/**
 * A home with two applied skills (one with a supporting file and a GitHub
 * source record) and one turned off, and its own builtin skills folder
 * (GENOFFICE_BUILTIN_SKILLS) so the repository's real builtins stay out.
 */
function fixture(opts: FixtureOptions = {}): Fixture {
  const home = tempDir()
  const userData = tempDir()
  const team = join(home, '.ieumoffice', 'skills', 'team-docs')
  mkdirSync(join(team, 'references'), { recursive: true })
  writeFileSync(join(team, 'SKILL.md'), TEAM_SKILL_MD)
  writeFileSync(join(team, 'references', 'style.md'), '# Style\n')
  writeFileSync(join(team, '.ieum-source.json'), '{"repo":"a/b"}')
  const grade = join(home, '.ieumoffice', 'skills', 'grade-review')
  mkdirSync(grade, { recursive: true })
  writeFileSync(join(grade, 'SKILL.md'), GRADE_SKILL_MD)
  const off = join(home, '.ieumoffice', 'skills', 'off-skill')
  mkdirSync(off, { recursive: true })
  writeFileSync(join(off, 'SKILL.md'), OFF_SKILL_MD)
  for (const extra of opts.extraSkills ?? []) {
    const dir = join(home, '.ieumoffice', 'skills', extra.folder)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), extra.md)
  }
  const builtin = join(home, 'builtin-skills')
  mkdirSync(builtin, { recursive: true })
  for (const spec of opts.builtins ?? []) {
    const dir = join(builtin, spec.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      skillMd(spec.name, `A builtin named ${spec.name}.`, spec.body),
    )
  }
  writeFileSync(
    join(builtin, 'builtin-skills.json'),
    JSON.stringify(
      (opts.builtins ?? []).map((spec) => ({
        name: spec.name,
        ...(spec.agentOnly ? { agentOnly: true } : {}),
      })),
    ),
  )
  writeFileSync(
    join(userData, 'app-settings.json'),
    JSON.stringify({
      skills: opts.skillSettings ?? { states: { 'app:off-skill': { enabled: false } } },
    }),
  )
  return {
    home,
    userData,
    env: {
      ...process.env,
      GENOFFICE_HOME: home,
      GENOFFICE_USER_DATA: userData,
      GENOFFICE_BUILTIN_SKILLS: builtin,
      GENOFFICE_AUDIT_LOG: 'off',
      // every home/settings location points into this fixture's temp folders,
      // so no platform reads the real user settings (packages/cli/AGENTS.md)
      HOME: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      XDG_CONFIG_HOME: join(home, '.config'),
    },
  }
}

interface ProfilesFixture extends Fixture {
  installedDir: string
  devDir: string
}

/** A home whose applied skill carries a template document (the `assets/` copy of a real document) */
function fixtureWithTemplate(): Fixture {
  const f = fixture({ extraSkills: [{ folder: 'template-docs', md: TEMPLATE_SKILL_MD }] })
  const assets = join(f.home, '.ieumoffice', 'skills', 'template-docs', 'assets')
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(assets, 'report.docx'), TEMPLATE_DOCUMENT)
  return f
}

/**
 * A home whose settings live in the two profiles a shell keeps (the installed
 * app's and the dev shell's, beside each other), GENOFFICE_USER_DATA unset.
 */
function profilesFixture(profiles: {
  installed?: Record<string, unknown>
  dev?: Record<string, unknown>
  /** the dev shell is running (its open-documents registry names a live process) */
  devLive?: boolean
}): ProfilesFixture {
  const home = tempDir()
  const root = tempDir()
  const team = join(home, '.ieumoffice', 'skills', 'team-docs')
  mkdirSync(team, { recursive: true })
  writeFileSync(join(team, 'SKILL.md'), TEAM_SKILL_MD)
  const off = join(home, '.ieumoffice', 'skills', 'off-skill')
  mkdirSync(off, { recursive: true })
  writeFileSync(join(off, 'SKILL.md'), OFF_SKILL_MD)
  const builtin = join(home, 'builtin-skills')
  mkdirSync(builtin, { recursive: true })
  writeFileSync(join(builtin, 'builtin-skills.json'), '[]')
  // every home/settings location points into the temp root on every platform,
  // so the test never reads the real %APPDATA%\IeumOffice (or Library/.config)
  // settings (packages/cli/AGENTS.md: the real home folder is never touched)
  const isolated: NodeJS.ProcessEnv = {
    HOME: root,
    APPDATA: join(root, 'AppData', 'Roaming'),
    XDG_CONFIG_HOME: join(root, '.config'),
  }
  const installedDir = genofficeUserDataDir(isolated)
  const devDir = genofficeDevUserDataDir(isolated)
  for (const [dir, settings] of [
    [installedDir, profiles.installed],
    [devDir, profiles.dev],
  ] as const) {
    if (!settings) continue
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'app-settings.json'), JSON.stringify(settings))
  }
  if (profiles.devLive) {
    mkdirSync(devDir, { recursive: true })
    writeFileSync(
      join(devDir, 'open-documents.json'),
      JSON.stringify({ pid: process.pid, paths: [] }),
    )
  }
  return {
    home,
    userData: devDir,
    installedDir,
    devDir,
    env: {
      ...process.env,
      ...isolated,
      GENOFFICE_HOME: home,
      GENOFFICE_USER_DATA: undefined,
      GENOFFICE_BUILTIN_SKILLS: builtin,
      GENOFFICE_AUDIT_LOG: 'off',
    },
  }
}

/** A connected MCP client on the in-memory transport, disposed after the test body */
async function withClient(
  env: NodeJS.ProcessEnv,
  body: (client: Client) => Promise<void>,
): Promise<void> {
  const ctx = createContext({ cwd: tempDir(), env, log: () => {} })
  try {
    const server = await createMcpServer(ctx)
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client({ name: 'skills-test', version: '0' })
    await client.connect(b)
    await body(client)
    await client.close()
  } finally {
    disposeContext(ctx)
  }
}

function textOf(contents: unknown): string {
  return (contents as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
}

describe('ieumoffice://skills resources (follow-along)', () => {
  it('lists name and description only, and only what is applied', async () => {
    const { env } = fixture()
    await withClient(env, async (client) => {
      const { resources } = await client.listResources()
      const uris = resources.map((r) => r.uri)
      expect(uris).toContain('ieumoffice://skills')
      expect(uris).toContain('ieumoffice://skills/team-docs')
      expect(uris).toContain('ieumoffice://skills/grade-review')
      expect(uris).not.toContain('ieumoffice://skills/off-skill')

      const listed = await client.readResource({ uri: 'ieumoffice://skills' })
      const text = textOf(listed.contents)
      // progressive disclosure: name and description, never a body
      expect(text).toContain('team-docs: Turn rough notes into a shared team document.')
      expect(text).toContain('grade-review: Review student records before submission.')
      expect(text).not.toContain('Follow these steps')
      expect(text).not.toContain('Check each record against')
      expect(text).not.toContain('This body must never leave')
      expect(text).not.toContain('off-skill')
    })
  })

  it('reads one applied skill as its SKILL.md', async () => {
    const { env } = fixture()
    await withClient(env, async (client) => {
      const read = await client.readResource({ uri: 'ieumoffice://skills/team-docs' })
      expect(textOf(read.contents)).toBe(TEAM_SKILL_MD)
    })
  })

  it('errors on an unknown skill name, naming the applied ones', async () => {
    const { env } = fixture()
    await withClient(env, async (client) => {
      await expect(
        client.readResource({ uri: 'ieumoffice://skills/no-such-skill' }),
      ).rejects.toThrow(/unknown skill: no-such-skill/)
      await expect(
        client.readResource({ uri: 'ieumoffice://skills/no-such-skill' }),
      ).rejects.toThrow(/team-docs/)
    })
  })

  it('a guessed name cannot reach a disabled skill body', async () => {
    const { env } = fixture()
    await withClient(env, async (client) => {
      // the name is guessable; the body behind it is not
      await expect(client.readResource({ uri: 'ieumoffice://skills/off-skill' })).rejects.toThrow(
        /unknown skill: off-skill/,
      )
      await expect(client.readResource({ uri: 'ieumoffice://skills/off-skill' })).rejects.toThrow(
        /applied skills: /,
      )
    })
  })

  it('a malformed name escape is the unknown-skill error, not a crash', async () => {
    const { env } = fixture()
    await withClient(env, async (client) => {
      await expect(client.readResource({ uri: 'ieumoffice://skills/%zz' })).rejects.toThrow(
        /unknown skill/,
      )
    })
  })

  it('never exposes a hidden builtin or an agent-window-only builtin', async () => {
    const { env } = fixture({
      builtins: [
        { name: 'hidden-tool', body: HIDDEN_BUILTIN_BODY },
        { name: 'agent-tool', body: AGENT_ONLY_BODY, agentOnly: true },
        { name: 'plain-tool', body: 'PLAIN-BUILTIN-BODY' },
      ],
      skillSettings: { states: {}, hiddenBuiltins: ['hidden-tool'] },
    })
    await withClient(env, async (client) => {
      const { resources } = await client.listResources()
      const uris = resources.map((r) => r.uri)
      expect(uris).toContain('ieumoffice://skills/plain-tool')
      const listed = textOf((await client.readResource({ uri: 'ieumoffice://skills' })).contents)
      expect(listed).toContain('plain-tool')
      for (const gone of ['hidden-tool', 'agent-tool']) {
        expect(uris).not.toContain(`ieumoffice://skills/${gone}`)
        expect(listed).not.toContain(gone)
      }
      expect(listed).not.toContain(HIDDEN_BUILTIN_BODY)
      expect(listed).not.toContain(AGENT_ONLY_BODY)
      // a guessed name reaches neither body
      for (const gone of ['hidden-tool', 'agent-tool']) {
        await expect(client.readResource({ uri: `ieumoffice://skills/${gone}` })).rejects.toThrow(
          /unknown skill/,
        )
      }
    })
  })

  it('exposes only the picked skill when two skills share a name', async () => {
    const { env } = fixture({
      builtins: [{ name: 'shared', body: SHADOWED_BUILTIN_BODY }],
      extraSkills: [
        // two app skills under one name: the first folder in order wins
        {
          folder: 'report-alpha',
          md: skillMd('report', 'The alpha report skill.', 'ALPHA-WINNER-BODY'),
        },
        {
          folder: 'report-beta',
          md: skillMd('report', 'The beta report skill.', SHADOWED_BETA_BODY),
        },
        // an app skill pushing the builtin back
        {
          folder: 'shared-app',
          md: skillMd('shared', 'The app copy of shared.', 'APP-WINNER-BODY'),
        },
      ],
    })
    await withClient(env, async (client) => {
      const { resources } = await client.listResources()
      const uris = resources.map((r) => r.uri)
      expect(uris.filter((u) => u === 'ieumoffice://skills/report')).toHaveLength(1)
      expect(uris.filter((u) => u === 'ieumoffice://skills/shared')).toHaveLength(1)

      const report = textOf(
        (await client.readResource({ uri: 'ieumoffice://skills/report' })).contents,
      )
      expect(report).toContain('ALPHA-WINNER-BODY')
      expect(report).not.toContain(SHADOWED_BETA_BODY)
      const sharedText = textOf(
        (await client.readResource({ uri: 'ieumoffice://skills/shared' })).contents,
      )
      expect(sharedText).toContain('APP-WINNER-BODY')
      expect(sharedText).not.toContain(SHADOWED_BUILTIN_BODY)

      const listed = textOf((await client.readResource({ uri: 'ieumoffice://skills' })).contents)
      expect(listed).not.toContain(SHADOWED_BETA_BODY)
      expect(listed).not.toContain(SHADOWED_BUILTIN_BODY)

      // the pushed-back skill's own identifier reaches nothing
      await expect(
        client.readResource({ uri: 'ieumoffice://skills/builtin:shared' }),
      ).rejects.toThrow(/unknown skill/)
    })
  })

  it('an empty applied set says so and points at the app', async () => {
    // every skill turned off: the list says so instead of going blank
    const { env } = fixture({
      skillSettings: {
        states: {
          'app:team-docs': { enabled: false },
          'app:grade-review': { enabled: false },
          'app:off-skill': { enabled: false },
        },
      },
    })
    await withClient(env, async (client) => {
      const listed = textOf((await client.readResource({ uri: 'ieumoffice://skills' })).contents)
      expect(listed).toContain('no skills applied in IeumOffice')
    })
    const out = join(tempDir(), 'publish')
    const r = await run(['skill', 'export', 'team-docs', '--out', out, '--json'], { env })
    expect(r.code).toBe(1)
    expect(r.json().error).toBe('invalid_argument')
    expect(r.json().suggestion).toContain('turn one on in the app first')
    expect(existsSync(out)).toBe(false)
  })

  // chmod 0o000 is a no-op on Windows, so the unreadable folder cannot be staged there
  it.skipIf(process.platform === 'win32')(
    'reports an unreadable skill folder as broken, not as missing',
    async () => {
      const { env, home } = fixture()
      const team = join(home, '.ieumoffice', 'skills', 'team-docs')
      chmodSync(team, 0o000)
      try {
        const md = await skillMdOf({
          id: 'app:team-docs',
          name: 'team-docs',
          title: 'Team document',
          description: 'x',
          dir: team,
          template: undefined,
        })
        expect(md).toMatchObject({ kind: 'broken' })
      } finally {
        chmodSync(team, 0o755)
      }
      // a folder without SKILL.md is genuinely missing, not broken
      const bare = join(tempDir(), 'bare')
      mkdirSync(bare)
      writeFileSync(join(bare, 'notes.md'), '# Notes\n')
      const md = await skillMdOf({
        id: 'app:bare',
        name: 'bare',
        title: 'bare',
        description: 'x',
        dir: bare,
        template: undefined,
      })
      expect(md).toMatchObject({ kind: 'missing' })
    },
  )
})

describe('skill on/off state across the app profiles', () => {
  it('does not expose a skill the running dev app turned off', async () => {
    // the installed profile alone would say "on"; the dev app's off must win
    const { env } = profilesFixture({
      installed: { skills: { states: { 'app:off-skill': { enabled: true } } } },
      dev: { skills: { states: { 'app:off-skill': { enabled: false } } } },
    })
    await withClient(env, async (client) => {
      const listed = textOf((await client.readResource({ uri: 'ieumoffice://skills' })).contents)
      expect(listed).not.toContain('off-skill')
      await expect(client.readResource({ uri: 'ieumoffice://skills/off-skill' })).rejects.toThrow(
        /unknown skill/,
      )
    })
    const out = join(tempDir(), 'publish')
    const r = await run(['skill', 'export', 'off-skill', '--out', out, '--json'], { env })
    expect(r.code).toBe(1)
    expect(r.json().error).toBe('invalid_argument')
    expect(existsSync(out)).toBe(false)
  })

  it('follows the live shell profile when the two profiles disagree', async () => {
    const { env } = profilesFixture({
      installed: { skills: { states: { 'app:team-docs': { enabled: false } } } },
      dev: { skills: { states: { 'app:team-docs': { enabled: true } } } },
      devLive: true,
    })
    await withClient(env, async (client) => {
      const read = await client.readResource({ uri: 'ieumoffice://skills/team-docs' })
      expect(textOf(read.contents)).toBe(TEAM_SKILL_MD)
    })
  })
})

describe('skill export', () => {
  it('writes an applied skill as a standard skill folder', async () => {
    const { env } = fixture()
    const out = join(tempDir(), 'publish')
    const r = await run(['skill', 'export', 'team-docs', '--out', out, '--json'], { env })
    expect(r.code).toBe(0)
    // the folder is the skill folder itself: SKILL.md and the supporting files
    expect(readFileSync(join(out, 'SKILL.md'), 'utf8')).toBe(TEAM_SKILL_MD)
    expect(readFileSync(join(out, 'references', 'style.md'), 'utf8')).toBe('# Style\n')
    // the app's GitHub source record is bookkeeping, not part of the standard
    expect(existsSync(join(out, '.ieum-source.json'))).toBe(false)
    expect(r.json().detail).toMatchObject({ name: 'team-docs', files: 2 })
  })

  it('refuses a non-empty output folder', async () => {
    const { env } = fixture()
    const out = tempDir()
    writeFileSync(join(out, 'keep.txt'), 'mine')
    const r = await run(['skill', 'export', 'team-docs', '--out', out, '--json'], { env })
    expect(r.code).toBe(2)
    expect(r.json()).toMatchObject({ error: 'output_exists' })
    // nothing was written over what was there
    expect(readFileSync(join(out, 'keep.txt'), 'utf8')).toBe('mine')
    expect(existsSync(join(out, 'SKILL.md'))).toBe(false)
  })

  it('errors on a skill that is not applied', async () => {
    const { env } = fixture()
    const out = join(tempDir(), 'publish')
    const r = await run(['skill', 'export', 'no-such-skill', '--out', out, '--json'], { env })
    expect(r.code).toBe(1)
    const json = r.json()
    expect(json.error).toBe('invalid_argument')
    expect(json.detail.supported).toContain('team-docs')
    expect(existsSync(out)).toBe(false)
  })

  it('needs a skill name and --out', async () => {
    const { env } = fixture()
    const out = join(tempDir(), 'publish')
    const noName = await run(['skill', 'export', '--out', out, '--json'], { env })
    expect(noName.code).toBe(1)
    expect(noName.json().error).toBe('missing_argument')
    expect(existsSync(out)).toBe(false)
    const noOut = await run(['skill', 'export', 'team-docs', '--json'], { env })
    expect(noOut.code).toBe(1)
    expect(noOut.json().error).toBe('missing_argument')
  })

  // chmod 0o000 is a no-op on Windows, so the unreadable --out parent cannot be staged there
  it.skipIf(process.platform === 'win32')('refuses an --out path that cannot be used', async () => {
    const { env } = fixture()
    // a file where the skill folder should go (ENOTDIR)
    const file = join(tempDir(), 'occupied')
    writeFileSync(file, 'x')
    const onFile = await run(['skill', 'export', 'team-docs', '--out', file, '--json'], { env })
    expect(onFile.code).toBe(1)
    expect(onFile.json().error).toBe('invalid_argument')
    // a place this program cannot read (EACCES): a clean error, never a raw errno
    const locked = join(tempDir(), 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o000)
    try {
      const inLocked = await run(
        ['skill', 'export', 'team-docs', '--out', join(locked, 'publish'), '--json'],
        { env },
      )
      expect(inLocked.code).toBe(1)
      expect(inLocked.json().error).toBe('invalid_argument')
    } finally {
      chmodSync(locked, 0o755)
    }
  })

  it('errors instead of writing a "standard skill folder" without SKILL.md', async () => {
    const dir = join(tempDir(), 'vanish')
    mkdirSync(dir)
    writeFileSync(join(dir, 'notes.md'), '# Notes\n')
    const out = join(tempDir(), 'publish')
    await expect(
      exportSkillFolder(
        {
          id: 'app:vanish',
          name: 'vanish',
          title: 'Vanish',
          description: 'x',
          dir,
          template: undefined,
        },
        out,
      ),
    ).rejects.toMatchObject({ reason: 'file_not_found' })
    // nothing of the partial export is left behind
    expect(existsSync(out)).toBe(false)
  })

  // chmod 0o000 is a no-op on Windows, so the unreadable source cannot be staged there
  it.skipIf(process.platform === 'win32')(
    'leaves no half-copied folder behind when a copy fails midway',
    async () => {
      const dir = join(tempDir(), 'failing')
      mkdirSync(join(dir, 'references'), { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), TEAM_SKILL_MD)
      writeFileSync(join(dir, 'references', 'style.md'), '# Style\n')
      // a supporting file the copy cannot read: the failure lands after SKILL.md
      chmodSync(join(dir, 'references', 'style.md'), 0o000)
      const out = join(tempDir(), 'publish')
      try {
        await expect(
          exportSkillFolder(
            {
              id: 'app:failing',
              name: 'failing',
              title: 'Failing',
              description: 'x',
              dir,
              template: undefined,
            },
            out,
          ),
        ).rejects.toMatchObject({
          reason: 'file_not_found',
          // the source cannot be read: the error says so, never "cannot write into the output folder"
          message: expect.stringContaining('cannot read the skill file'),
        })
      } finally {
        chmodSync(join(dir, 'references', 'style.md'), 0o644)
      }
      expect(existsSync(join(out, 'SKILL.md'))).toBe(false)
      expect(existsSync(out)).toBe(false)
    },
  )

  it('exports the picked skill of a shared name', async () => {
    const { env } = fixture({
      extraSkills: [
        {
          folder: 'report-alpha',
          md: skillMd('report', 'The alpha report skill.', 'ALPHA-WINNER-BODY'),
        },
        {
          folder: 'report-beta',
          md: skillMd('report', 'The beta report skill.', SHADOWED_BETA_BODY),
        },
      ],
    })
    const out = join(tempDir(), 'publish')
    const r = await run(['skill', 'export', 'report', '--out', out, '--json'], { env })
    expect(r.code).toBe(0)
    // a shared name exports the picked skill, never the pushed-back one
    const md = readFileSync(join(out, 'SKILL.md'), 'utf8')
    expect(md).toContain('ALPHA-WINNER-BODY')
    expect(md).not.toContain(SHADOWED_BETA_BODY)
  })

  it('leaves the template document out of the export by default and says so', async () => {
    const { env } = fixtureWithTemplate()
    const out = join(tempDir(), 'publish')
    const r = await run(['skill', 'export', 'template-docs', '--out', out, '--json'], { env })
    expect(r.code).toBe(0)
    // a template document is a copy of a real document: never in a shareable
    // folder unless the person asks for it
    expect(existsSync(join(out, 'assets', 'report.docx'))).toBe(false)
    expect(readFileSync(join(out, 'SKILL.md'), 'utf8')).toBe(TEMPLATE_SKILL_MD)
    expect(r.json().detail).toMatchObject({ template_included: false })
    expect(r.json().warnings).toContainEqual(expect.objectContaining({ code: 'template_left_out' }))
  })

  it('copies the template document with --include-template and warns', async () => {
    const { env } = fixtureWithTemplate()
    const out = join(tempDir(), 'publish')
    const r = await run(
      ['skill', 'export', 'template-docs', '--out', out, '--include-template', '--json'],
      { env },
    )
    expect(r.code).toBe(0)
    expect(readFileSync(join(out, 'assets', 'report.docx'), 'utf8')).toBe(TEMPLATE_DOCUMENT)
    expect(r.json().detail).toMatchObject({ template_included: true })
    expect(r.json().warnings).toContainEqual(expect.objectContaining({ code: 'template_included' }))
  })
})
