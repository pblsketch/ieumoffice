/**
 * Unit and security tests for the restricted synchronous script macro interpreter.
 */
import { describe, expect, it } from 'vitest'
import {
  BIDI_AND_INVISIBLE_RE,
  DEFAULT_MACRO_LIMITS,
  FORBIDDEN_PROP_NAMES,
  INTERPRETER_CAPABILITIES,
  MAX_INT32,
  MacroRuntimeError,
  MacroSyntaxError,
  createSafeBag,
  findDisallowedInvisibleChar,
  parseMacroScript,
  runMacroScript,
  sanitizeHostValue,
  validateMacroLimits,
  validateMacroSyntax,
} from '../studio-plugin/macro-interpreter.mjs'

describe('macro-interpreter: limits validation', () => {
  it('returns default limits when omitted or null', () => {
    expect(validateMacroLimits()).toEqual(DEFAULT_MACRO_LIMITS)
    expect(validateMacroLimits(null)).toEqual(DEFAULT_MACRO_LIMITS)
    expect(DEFAULT_MACRO_LIMITS.maxTimeMs).toBe(30_000)
    expect(DEFAULT_MACRO_LIMITS.maxSteps).toBe(100_000)
    expect(DEFAULT_MACRO_LIMITS.maxCallDepth).toBe(64)
    expect(DEFAULT_MACRO_LIMITS.maxStringLength).toBe(1_000_000)
    expect(DEFAULT_MACRO_LIMITS.maxCollectionSize).toBe(50_000)
    expect(DEFAULT_MACRO_LIMITS.maxScriptBytes).toBe(256 * 1024)
    expect(DEFAULT_MACRO_LIMITS.maxMemoryBytes).toBe(64 * 1024 * 1024)
  })

  it('accepts valid integer overrides up to MAX_INT32', () => {
    const limits = validateMacroLimits({
      maxTimeMs: 5_000,
      maxSteps: MAX_INT32,
      maxCallDepth: 16,
    })
    expect(limits.maxTimeMs).toBe(5_000)
    expect(limits.maxSteps).toBe(MAX_INT32)
    expect(limits.maxCallDepth).toBe(16)
    expect(limits.maxStringLength).toBe(DEFAULT_MACRO_LIMITS.maxStringLength)
  })

  it.each([
    ['zero', 0],
    ['negative integer', -1],
    ['fractional float', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
    ['MAX_INT32 + 1', MAX_INT32 + 1],
  ])('rejects invalid numeric limit (%s)', (_label, badValue) => {
    expect(() => validateMacroLimits({ maxSteps: badValue })).toThrow(RangeError)
    expect(() => validateMacroLimits({ maxTimeMs: badValue })).toThrow(RangeError)
    expect(() => validateMacroLimits({ maxCallDepth: badValue })).toThrow(RangeError)
    expect(() => validateMacroLimits({ maxStringLength: badValue })).toThrow(RangeError)
    expect(() => validateMacroLimits({ maxCollectionSize: badValue })).toThrow(RangeError)
    expect(() => validateMacroLimits({ maxScriptBytes: badValue })).toThrow(RangeError)
    expect(() => validateMacroLimits({ maxMemoryBytes: badValue })).toThrow(RangeError)
    expect(() => runMacroScript('1 + 1', {}, { maxSteps: badValue })).toThrow(RangeError)
  })
})

describe('macro-interpreter: grammar and execution', () => {
  it('handles comments (line and multiline block) and literals', () => {
    const script = `
      // single line comment
      /* multiline
         block comment */
      const intVal = 42;
      const floatVal = 3.5;
      const sciVal = 1.5e2;
      const hexVal = 0x10;
      const binVal = 0b1010;
      const octVal = 0o12;
      const strSingle = 'hello\\n\\t\\'world\\'';
      const strDouble = "a\\x41\\u0042\\u{43}\\"\\\\";
      const flags = [true, false, null, undefined];
      ({ intVal, floatVal, sciVal, hexVal, binVal, octVal, strSingle, strDouble, flags });
    `
    const res = runMacroScript(script)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as Record<string, unknown>
    expect(Object.getPrototypeOf(val)).toBe(null)
    expect(val.intVal).toBe(42)
    expect(val.floatVal).toBe(3.5)
    expect(val.sciVal).toBe(150)
    expect(val.hexVal).toBe(16)
    expect(val.binVal).toBe(10)
    expect(val.octVal).toBe(10)
    expect(val.strSingle).toBe("hello\n\t'world'")
    expect(val.strDouble).toBe('aABC"\\')
    expect(val.flags).toEqual([true, false, null, undefined])
  })

  it('supports var, let, const scoping and rejects const reassignment', () => {
    const res = runMacroScript(`
      var a = 1, b = 2;
      var a; // re-declaration without initializer preserves value
      let x = 10;
      {
        let x = 20;
        var a = 99;
        b += x;
      }
      [a, b, x];
    `)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual([99, 22, 10])
    }

    const constErr = runMacroScript(`const k = 1;\nk = 2;`)
    expect(constErr.ok).toBe(false)
    if (!constErr.ok) {
      expect(constErr.code).toBe('type_error')
      expect(constErr.line).toBe(2)
      expect(constErr.column).toBe(1)
    }
  })

  it('supports arithmetic, comparison, logical short-circuiting, ternary, unary, update, and compound assignment', () => {
    const res = runMacroScript(`
      let side = 0;
      function bump() { side++; return 7; }
      const sc1 = false && bump();
      const sc2 = true || bump();
      const sc3 = 0 ?? bump();
      const sc4 = null ?? bump();
      let n = 10;
      const post = n++;
      const pre = ++n;
      n += 5;
      n -= 3;
      n *= 2;
      n /= 4;
      n %= 5;
      const obj = { count: 1 };
      obj.count += 4;
      obj["count"]--;
      const powVal = 2 ** 3 ** 2;
      const negVal = -(-5) + +("3");
      const cmp = [1 == "1", 1 === "1", 1 != "2", 1 !== "1", 2 < 3, 3 <= 3, 4 > 2, 4 >= 5];
      const types = [typeof side, typeof "a", typeof true, typeof null, typeof undefined, typeof bump, typeof unknownName];
      const tern = obj.count === 4 ? "yes" : "no";
      ({ side, sc1, sc2, sc3, sc4, post, pre, n, count: obj.count, powVal, negVal, cmp, types, tern });
    `)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value).toEqual({
      side: 1,
      sc1: false,
      sc2: true,
      sc3: 0,
      sc4: 7,
      post: 10,
      pre: 12,
      n: 2,
      count: 4,
      powVal: 512,
      negVal: 8,
      cmp: [true, false, true, true, true, true, true, false],
      types: ['number', 'string', 'boolean', 'object', 'undefined', 'function', 'undefined'],
      tern: 'yes',
    })
  })

  it('supports if/else, for, for..of, while, do..while, switch, break, and continue', () => {
    const res = runMacroScript(`
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) continue;
        if (i > 7) break;
        sum += i;
      }

      const letters = [];
      for (const ch of "abc") {
        letters.push(ch);
      }

      let w = 0;
      while (w < 4) { w++; }

      let d = 0;
      do { d++; } while (d < 1);

      let sw = "";
      switch (2) {
        case 1: sw = "one"; break;
        case 2: sw = "two"; break;
        default: sw = "other";
      }

      const closures = [];
      for (let i = 0; i < 3; i++) {
        closures.push(() => i);
      }
      const captured = closures.map((fn) => fn());

      ({ sum, letters, w, d, sw, captured });
    `)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value).toEqual({
      sum: 16,
      letters: ['a', 'b', 'c'],
      w: 4,
      d: 1,
      sw: 'two',
      captured: [0, 1, 2],
    })
  })

  it('supports function declarations (hoisted), function expressions, arrow functions, recursion, and top-level return', () => {
    const res = runMacroScript(`
      const hoisted = fact(5);
      function fact(n) {
        if (n <= 1) return 1;
        return n * fact(n - 1);
      }
      const mul = function (a, b) { return a * b; };
      const add = (a, b) => a + b;
      const dbl = x => x * 2;
      const blk = (x) => { const y = x + 1; return y * y; };
      return [hoisted, mul(3, 4), add(2, 5), dbl(6), blk(4)];
      const unreachable = 999;
    `)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual([120, 12, 7, 12, 25])
    }
  })

  it('supports allowlisted String and Array methods and safe built-in globals', () => {
    const res = runMacroScript(`
      const s = "  Hello, World!  ";
      const sOps = {
        len: s.length,
        trim: s.trim(),
        trimStart: s.trimStart(),
        trimEnd: s.trimEnd(),
        lower: s.trim().toLowerCase(),
        upper: s.trim().toUpperCase(),
        slice: s.trim().slice(0, 5),
        sub: s.trim().substring(7, 12),
        idx: s.indexOf("World"),
        lastIdx: "aba".lastIndexOf("a"),
        inc: s.includes("Hello"),
        starts: s.trim().startsWith("Hello"),
        ends: s.trim().endsWith("!"),
        ch: "xyz".charAt(1),
        rep: "ab".repeat(3),
        r1: "a-b-a".replace("a", "X"),
        rAll: "a-b-a".replaceAll("a", "X"),
        parts: "a,b,c".split(","),
      };

      const arr = [1, 2, 3];
      arr.push(4);
      const popped = arr.pop();
      arr.unshift(0);
      const shifted = arr.shift();
      const aOps = {
        popped,
        shifted,
        joined: arr.join("-"),
        sliced: arr.slice(1),
        concatted: arr.concat([4, 5]),
        idx: arr.indexOf(2),
        inc: arr.includes(3),
        mapped: arr.map(x => x * 10),
        filtered: arr.filter(x => x >= 2),
        found: arr.find(x => x > 1),
        foundIdx: arr.findIndex(x => x > 1),
        someGt2: arr.some(x => x > 2),
        everyPos: arr.every(x => x > 0),
        reduced: arr.reduce((acc, x) => acc + x, 0),
        rev: [1, 2, 3].reverse(),
      };

      const builtIns = {
        abs: Math.abs(-5),
        floor: Math.floor(2.9),
        ceil: Math.ceil(2.1),
        round: Math.round(2.5),
        trunc: Math.trunc(-2.9),
        max: Math.max(1, 9, 3),
        min: Math.min(1, -2, 3),
        pow: Math.pow(3, 2),
        sqrt: Math.sqrt(16),
        sign: Math.sign(-7),
        num: Number("42"),
        isFin: Number.isFinite(10),
        isInt: Number.isInteger(10),
        pInt: Number.parseInt("ff", 16),
        pFloat: Number.parseFloat("3.14px"),
        str: String(123),
        bool: Boolean(0),
        isArr: Array.isArray(arr),
        keys: Object.keys({ a: 1, b: 2 }),
        vals: Object.values({ a: 1, b: 2 }),
        ents: Object.entries({ a: 1 }),
        jsonStr: JSON.stringify({ a: 1, b: [true, "x"] }),
        jsonParsed: JSON.parse('{"k":123,"nested":{"ok":true}}'),
      };

      ({ sOps, aOps, builtIns });
    `)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as any
    expect(val.sOps.trim).toBe('Hello, World!')
    expect(val.sOps.rep).toBe('ababab')
    expect(val.sOps.r1).toBe('X-b-a')
    expect(val.sOps.rAll).toBe('X-b-X')
    expect(val.sOps.parts).toEqual(['a', 'b', 'c'])
    expect(val.aOps.joined).toBe('1-2-3')
    expect(val.aOps.mapped).toEqual([10, 20, 30])
    expect(val.aOps.filtered).toEqual([2, 3])
    expect(val.aOps.reduced).toBe(6)
    expect(val.aOps.rev).toEqual([3, 2, 1])
    expect(val.builtIns.pInt).toBe(255)
    expect(val.builtIns.pFloat).toBe(3.14)
    expect(val.builtIns.jsonStr).toBe('{"a":1,"b":[true,"x"]}')
    expect(Object.getPrototypeOf(val.builtIns.jsonParsed)).toBe(null)
    expect(Object.getPrototypeOf(val.builtIns.jsonParsed.nested)).toBe(null)
  })
})

describe('macro-interpreter: exact line and column reporting', () => {
  it('reports exact 1-based line and column on syntax errors across multiline comments', () => {
    const src = 'const a = 1;\n/* comment\nline 3 */\n  const b = @;'
    const parsed = parseMacroScript(src)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.code).toBe('syntax_error')
      expect(parsed.line).toBe(4)
      expect(parsed.column).toBe(13)
    }

    const validated = validateMacroSyntax(src)
    expect(validated.ok).toBe(false)
    if (!validated.ok) {
      expect(validated.line).toBe(4)
      expect(validated.column).toBe(13)
    }
  })

  it('reports exact 1-based line and column on runtime errors', () => {
    const src = 'const x = 1;\nconst y = 2;\n    unknownVar + 1;'
    const res = runMacroScript(src)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('unknown_identifier')
      expect(res.line).toBe(3)
      expect(res.column).toBe(5)
    }
  })

  it('instantiates MacroSyntaxError and MacroRuntimeError with structured fields', () => {
    const sErr = new MacroSyntaxError('bad syntax', 3, 7)
    expect(sErr).toBeInstanceOf(Error)
    expect(sErr.code).toBe('syntax_error')
    expect(sErr.line).toBe(3)
    expect(sErr.column).toBe(7)

    const rErr = new MacroRuntimeError('limit hit', 'step_limit', 5, 2)
    expect(rErr).toBeInstanceOf(Error)
    expect(rErr.code).toBe('step_limit')
    expect(rErr.line).toBe(5)
    expect(rErr.column).toBe(2)
  })
})

describe('macro-interpreter: bounded execution limits', () => {
  it('stops infinite loop via step_limit', () => {
    const res = runMacroScript('while (true) {}', {}, { maxSteps: 250 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('step_limit')
      expect(res.line).toBe(1)
      expect(res.steps).toBeGreaterThan(250)
    }
  })

  it('stops execution via time_limit using injectable clock without sleeping', () => {
    let fakeNow = 1000
    const res = runMacroScript(
      'let i = 0; while (true) { i++; }',
      {},
      {
        maxSteps: 100_000,
        maxTimeMs: 30_000,
        now: () => {
          fakeNow += 5_000
          return fakeNow
        },
      },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('time_limit')
      expect(res.elapsedMs).toBeGreaterThan(30_000)
    }
  })

  it('stops deep recursion via call_depth_limit', () => {
    const res = runMacroScript(
      'function dive(n) { return dive(n + 1); }\ndive(0);',
      {},
      { maxCallDepth: 16 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('call_depth_limit')
      expect(res.line).toBe(1)
    }
  })

  it('blocks exponential string growth bomb (s = s + s) via memory_limit', () => {
    const res = runMacroScript(
      'let s = "a"; for (let i = 0; i < 30; i++) { s = s + s; }',
      {},
      { maxStringLength: 1024 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('memory_limit')
    }
  })

  it('blocks String.repeat memory bomb via memory_limit', () => {
    const res = runMacroScript('"a".repeat(1000000000);', {}, { maxStringLength: 10_000 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('memory_limit')
    }
  })

  it('blocks huge array push growth via memory_limit', () => {
    const res = runMacroScript(
      'const arr = []; for (let i = 0; i < 500; i++) { arr.push(i); }',
      {},
      { maxCollectionSize: 50 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('memory_limit')
    }
  })

  it('blocks huge array join string explosion via memory_limit', () => {
    const res = runMacroScript(
      'const chunk = "x".repeat(100); const a = [chunk, chunk, chunk, chunk]; a.join("-");',
      {},
      { maxStringLength: 250 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('memory_limit')
    }
  })

  it('blocks oversized script source via script_too_large', () => {
    const huge = 'const x = "' + 'a'.repeat(500) + '";'
    const parsed = parseMacroScript(huge, { maxScriptBytes: 128 })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.code).toBe('script_too_large')
    }
    const ran = runMacroScript(huge, {}, { maxScriptBytes: 128 })
    expect(ran.ok).toBe(false)
    if (!ran.ok) {
      expect(ran.code).toBe('script_too_large')
    }
  })
})

describe('macro-interpreter: sandbox and forbidden access defenses', () => {
  const blockedRuntimeGlobals = [
    'window',
    'globalThis',
    'self',
    'global',
    'document',
    'process',
    'require',
    'module',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'setTimeout',
    'setInterval',
    'Promise',
    'Proxy',
    'Reflect',
    'localStorage',
    'navigator',
    'ipcRenderer',
    'hwpApi',
  ]

  it.each(blockedRuntimeGlobals)('blocks access to host global "%s"', (name) => {
    const res = runMacroScript(`const x = ${name};`)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('unknown_identifier')
      expect(res.line).toBe(1)
      expect(res.column).toBe(11)
    }
  })

  it('explicitly rejects eval and Function identifiers as syntax errors', () => {
    const rEval = runMacroScript('eval("1 + 1");')
    expect(rEval.ok).toBe(false)
    if (!rEval.ok) {
      expect(rEval.code).toBe('syntax_error')
      expect(rEval.line).toBe(1)
      expect(rEval.column).toBe(1)
    }

    const rFn = runMacroScript('Function("return 1")();')
    expect(rFn.ok).toBe(false)
    if (!rFn.ok) {
      expect(rFn.code).toBe('syntax_error')
      expect(rFn.line).toBe(1)
      expect(rFn.column).toBe(1)
    }
  })

  it.each([
    'new Object()',
    'class Foo {}',
    'import x from "y";',
    'export const x = 1;',
    'with ({}) {}',
    'this.x',
    'super.x',
    'async function f() {}',
    'await 1;',
    'yield 1;',
    'try { 1; } catch (e) {}',
  ])('rejects disallowed language construct "%s" with MacroSyntaxError', (code) => {
    const parsed = parseMacroScript(code)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.code).toBe('syntax_error')
      expect(parsed.line).toBe(1)
      expect(parsed.column).toBeGreaterThanOrEqual(1)
    }
  })

  it('exports FORBIDDEN_PROP_NAMES containing all dangerous prototype keys', () => {
    expect(FORBIDDEN_PROP_NAMES.has('constructor')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('__proto__')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('prototype')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('__defineGetter__')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('__defineSetter__')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('__lookupGetter__')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('__lookupSetter__')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('caller')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('callee')).toBe(true)
    expect(FORBIDDEN_PROP_NAMES.has('arguments')).toBe(true)
  })

  it.each([
    ['({}).__proto__', '({}).__proto__;'],
    ['([]).constructor', '([]).constructor;'],
    ['("").constructor', '("").constructor;'],
    ['(1).constructor', '(1).constructor;'],
    ['(true).constructor', '(true).constructor;'],
    ['fn.constructor', 'function fn() {} fn.constructor;'],
    ['api.constructor', 'api.constructor;'],
    ['Object.prototype', 'Object.prototype;'],
    ['Array.prototype', 'Array.prototype;'],
    ['fn.caller', 'function fn() {} fn.caller;'],
    ['fn.arguments', 'function fn() {} fn.arguments;'],
  ])('blocks dot access to forbidden property (%s)', (_label, script) => {
    const res = runMacroScript(script, { api: { ping: () => 'pong' } })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('forbidden_property')
      expect(res.line).toBe(1)
    }
  })

  it.each([
    ['computed __proto__ on object', '({})["__pro" + "to__"];'],
    ['computed constructor on string', '("")["con" + "structor"];'],
    ['computed constructor on array', '([])["con" + "structor"];'],
    ['computed constructor on host API', 'api["con" + "structor"];'],
    ['variable key __defineGetter__', 'const k = "__defineGetter__"; const o = {}; o[k];'],
    ['variable key prototype on Object', 'const k = "proto" + "type"; Object[k];'],
    ['computed write __proto__', 'const o = {}; o["__pro" + "to__"] = { polluted: 1 };'],
    ['computed write constructor', 'const o = {}; o["con" + "structor"] = 1;'],
  ])('blocks computed bypass attempt (%s)', (_label, script) => {
    const res = runMacroScript(script, { api: { ping: () => 'pong' } })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('forbidden_property')
    }
  })

  it('blocks prototype pollution in object literals and JSON.parse', () => {
    const litDirect = runMacroScript('const o = { __proto__: { polluted: 1 } }; o;')
    expect(litDirect.ok).toBe(false)
    if (!litDirect.ok) {
      expect(litDirect.code).toBe('forbidden_property')
    }

    const litComputed = runMacroScript('const o = { ["__pro" + "to__"]: 1 }; o;')
    expect(litComputed.ok).toBe(false)
    if (!litComputed.ok) {
      expect(litComputed.code).toBe('forbidden_property')
    }

    const jsonProto = runMacroScript('JSON.parse(\'{"__proto__":{"polluted":1}}\');')
    expect(jsonProto.ok).toBe(false)
    if (!jsonProto.ok) {
      expect(jsonProto.code).toBe('forbidden_property')
    }

    // Verify Object.prototype itself was never polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('creates prototype-free script objects and freezes host API namespaces while supporting mutable safe bags', () => {
    const paramBag = createSafeBag({ find: '', replace: '' })
    const log: string[] = []
    const api = {
      exec(bag: Record<string, unknown>) {
        log.push(`${String(bag.find)}->${String(bag.replace)}`)
        return { count: 2, ok: true }
      },
    }
    const globals = {
      api,
      params: { findReplace: paramBag },
    }

    const okRes = runMacroScript(
      `
      params.findReplace.find = "old";
      params.findReplace.replace = "new";
      const out = api.exec(params.findReplace);
      const localObj = { a: 1, out };
      localObj;
    `,
      globals,
    )
    expect(okRes.ok).toBe(true)
    expect(log).toEqual(['old->new'])
    expect(paramBag.find).toBe('old')
    expect(paramBag.replace).toBe('new')
    if (okRes.ok) {
      const val = okRes.value as Record<string, unknown>
      expect(Object.getPrototypeOf(val)).toBe(null)
      expect(Object.getPrototypeOf(val.out)).toBe(null)
      expect(val.out).toEqual({ count: 2, ok: true })
    }

    // Host API namespace must be frozen: mutation attempts fail with type_error.
    const mutateApi = runMacroScript('api.exec = 123;', globals)
    expect(mutateApi.ok).toBe(false)
    if (!mutateApi.ok) {
      expect(mutateApi.code).toBe('type_error')
    }

    const mutateParamsNs = runMacroScript('params.findReplace = {};', globals)
    expect(mutateParamsNs.ok).toBe(false)
    if (!mutateParamsNs.ok) {
      expect(mutateParamsNs.code).toBe('type_error')
    }

    // Mutating forbidden property on a mutable safe bag is still blocked.
    const bagProto = runMacroScript('params.findReplace.__proto__ = {};', globals)
    expect(bagProto.ok).toBe(false)
    if (!bagProto.ok) {
      expect(bagProto.code).toBe('forbidden_property')
    }
  })

  it('does not expose non-allowlisted prototype methods on strings or arrays', () => {
    const res = runMacroScript(`
      const sMethod = "abc".match;
      const aMethod = [1, 2].toLocaleString;
      const nMethod = (42).toString;
      [sMethod, aMethod, nMethod];
    `)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual([undefined, undefined, undefined])
    }
  })

  it('sanitizeHostValue clones deeply into prototype-free objects and rejects forbidden keys', () => {
    const clean = sanitizeHostValue({ a: 1, nested: { b: [1, { c: 'ok' }] } }) as any
    expect(Object.getPrototypeOf(clean)).toBe(null)
    expect(Object.getPrototypeOf(clean.nested)).toBe(null)
    expect(Object.getPrototypeOf(clean.nested.b[1])).toBe(null)
    expect(clean.nested.b[1].c).toBe('ok')

    const dirty = JSON.parse('{"__proto__": {"x": 1}}')
    expect(() => sanitizeHostValue(dirty)).toThrow(MacroRuntimeError)
    expect(() => createSafeBag(dirty)).toThrow(MacroRuntimeError)
  })

  it('enforces cumulative maxMemoryBytes across repeated string and collection allocations', () => {
    const res = runMacroScript(
      `
      var a = [];
      var s = "x".repeat(50000);
      for (var i = 0; i < 100; i++) {
        a.push((s + i).toUpperCase());
      }
      a.length;
    `,
      {},
      { maxMemoryBytes: 1_000_000 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('memory_limit')
    }

    // Host return values and JSON.parse are also charged against maxMemoryBytes.
    const hostAlloc = runMacroScript(
      `
      var out = [];
      for (var i = 0; i < 40; i++) {
        out.push(makeBig());
      }
      out.length;
    `,
      { makeBig: () => 'a'.repeat(40_000) },
      { maxMemoryBytes: 500_000 },
    )
    expect(hostAlloc.ok).toBe(false)
    if (!hostAlloc.ok) {
      expect(hostAlloc.code).toBe('memory_limit')
    }

    const jsonAlloc = runMacroScript(
      `
      var raw = '["' + "z".repeat(40000) + '"]';
      var parsed = [];
      for (var i = 0; i < 40; i++) {
        parsed.push(JSON.parse(raw));
      }
      parsed.length;
    `,
      {},
      { maxMemoryBytes: 500_000 },
    )
    expect(jsonAlloc.ok).toBe(false)
    if (!jsonAlloc.ok) {
      expect(jsonAlloc.code).toBe('memory_limit')
    }
  })

  it('uses live reachable memory accounting so temporary strings succeed while retained allocations still hit memory_limit', () => {
    const concat10k = runMacroScript(
      'var s = ""; for (var i = 0; i < 10000; i++) { s = s + "x"; } s.length;',
    )
    expect(concat10k.ok).toBe(true)
    if (concat10k.ok) {
      expect(concat10k.value).toBe(10_000)
    }

    const csv3k = runMacroScript(
      'var s = ""; for (var i = 0; i < 3000; i++) { s += "row," + i + "\\n"; } s.length;',
    )
    expect(csv3k.ok).toBe(true)
    if (csv3k.ok) {
      expect(csv3k.value).toBeGreaterThan(20_000)
    }

    const discardedHost = runMacroScript(
      'var c = 0; for (var i = 0; i < 40; i++) { c += makeBig().length; } c;',
      { makeBig: () => 'a'.repeat(40_000) },
      { maxMemoryBytes: 500_000 },
    )
    expect(discardedHost.ok).toBe(true)
    if (discardedHost.ok) {
      expect(discardedHost.value).toBe(1_600_000)
    }

    // Shared object references are not double-counted across multiple bindings.
    const sharedObj = runMacroScript(
      `
      var big = { payload: "x".repeat(40000) };
      var refs = [];
      for (var i = 0; i < 100; i++) {
        refs.push(big);
      }
      refs.length;
    `,
      {},
      { maxMemoryBytes: 300_000 },
    )
    expect(sharedObj.ok).toBe(true)
    if (sharedObj.ok) {
      expect(sharedObj.value).toBe(100)
    }

    // Large retained distinct strings still trip memory_limit cleanly.
    const p2Retain = runMacroScript(
      `
      var a = [];
      var s = "x".repeat(999990);
      for (var i = 0; i < 100; i++) {
        a.push((s + i).toUpperCase());
      }
      a.length;
    `,
    )
    expect(p2Retain.ok).toBe(false)
    if (!p2Retain.ok) {
      expect(p2Retain.code).toBe('memory_limit')
    }

    // External step budget hook charges steps directly against maxSteps.
    let budgetHandle: { addSteps: (n: number) => void; checkLimits: () => void } | null = null
    const extSteps = runMacroScript(
      'doWork();',
      {
        doWork: () => {
          budgetHandle?.addSteps(500)
          return 'ok'
        },
      },
      {
        maxSteps: 100,
        onRegisterBudget: (b) => {
          budgetHandle = b
        },
      },
    )
    expect(extSteps.ok).toBe(false)
    if (!extSteps.ok) {
      expect(extSteps.code).toBe('step_limit')
      expect(extSteps.line).toBe(1)
    }
  })

  it('tracks per-allocation identity for long strings so shared refs pass while distinct allocations trip memory_limit', () => {
    // 70 objects referencing the same 500k string + >8 MiB temporary allocations.
    const sharedRows = runMacroScript(`
      var t = "x".repeat(500000);
      var rows = [];
      for (var i = 0; i < 70; i++) {
        rows.push({ i: i, src: t });
      }
      var z;
      for (var j = 0; j < 10; j++) {
        z = "q".repeat(900000);
      }
      rows.length;
    `)
    expect(sharedRows.ok).toBe(true)
    if (sharedRows.ok) {
      expect(sharedRows.value).toBe(70)
    }

    // Recursion passing the same 600k string at depth 30 + >8 MiB temporary allocations.
    const sharedRecursion = runMacroScript(`
      var big = "x".repeat(600000);
      function walk(t, i) {
        if (i >= 30) {
          var pad;
          for (var j = 0; j < 10; j++) {
            pad = "y".repeat(900000);
          }
          return pad.length;
        }
        return walk(t, i + 1);
      }
      walk(big, 0);
    `)
    expect(sharedRecursion.ok).toBe(true)
    if (sharedRecursion.ok) {
      expect(sharedRecursion.value).toBe(900_000)
    }

    // Shared host-returned 500k string referenced 70 times also keeps single identity.
    const sharedHost = runMacroScript(
      `
      var t = getDocText();
      var rows = [];
      for (var i = 0; i < 70; i++) {
        rows.push({ i: i, src: t });
      }
      var z;
      for (var j = 0; j < 10; j++) {
        z = "q".repeat(900000);
      }
      rows.length;
    `,
      { getDocText: () => 'h'.repeat(500_000) },
    )
    expect(sharedHost.ok).toBe(true)
    if (sharedHost.ok) {
      expect(sharedHost.value).toBe(70)
    }

    // 1,000 distinct identical-content allocations MUST NOT collapse and MUST trip memory_limit.
    const distinctIdentical = runMacroScript(`
      var a = [];
      for (var i = 0; i < 1000; i++) {
        a.push("x".repeat(999000));
      }
      a.length;
    `)
    expect(distinctIdentical.ok).toBe(false)
    if (!distinctIdentical.ok) {
      expect(distinctIdentical.code).toBe('memory_limit')
    }
  })

  it('preserves full JavaScript string semantics on tracked long strings and never leaks boxes across host boundaries', () => {
    const bag = createSafeBag({ text: '' })
    const hostSeen: Array<{
      directType: string
      directLen: number
      objType: string
      arrType: string
      bagType: string
      bagLen: number
    }> = []

    const res = runMacroScript(
      `
      const a = "a".repeat(300);
      const b = "a".repeat(300);
      const c = "b".repeat(300);
      const numStr = " ".repeat(300) + "42";
      const padded = "  " + "x".repeat(300) + "  ";

      // typeof, equality, relational, numeric coercion
      const typeOfA = typeof a;
      const eqStrict = [a === b, a !== b, a === c, a !== c];
      const eqLoose = [a == b, a != c, numStr == 42, Number(numStr), +numStr, Number.parseInt(numStr, 10)];
      const rel = [a < c, a <= b, c > a, c >= b, a < "b", "a" < a];
      const truthy = [Boolean(a), !a, a ? 1 : 0, (a && 7), (a || 9) === b];

      // indexing, length, concatenation, compound +=
      let cat = a + "Z";
      cat += "!";
      const indexing = [a.length, a[0], a[299], a[300], cat.length, cat[300], cat[301]];

      // for..of
      let forOfCount = 0;
      let firstCh = "";
      for (const ch of a) {
        if (forOfCount === 0) firstCh = ch;
        forOfCount++;
      }

      // switch
      let sw = "miss";
      switch (b) {
        case c: sw = "c"; break;
        case a: sw = "a"; break;
      }

      // String methods
      const methods = {
        sliceLen: a.slice(10, 290).length,
        subLen: a.substring(0, 270).length,
        idx: cat.indexOf("Z"),
        lastIdx: cat.lastIndexOf("a"),
        inc: cat.includes(b),
        starts: cat.startsWith(b),
        ends: cat.endsWith("Z!"),
        trimLen: padded.trim().length,
        trimStartLen: padded.trimStart().length,
        trimEndLen: padded.trimEnd().length,
        upperEq: a.toUpperCase() === "A".repeat(300),
        lowerEq: a.toUpperCase().toLowerCase() === a,
        charAt0: a.charAt(0),
        repEq: a.replace("a", "Q")[0] === "Q",
        repNoMatchEq: a.replace("z", "Q") === a,
        repAllEq: a.replaceAll("a", "k") === "k".repeat(300),
        splitLens: (a + "," + c).split(",").map(p => p.length),
      };

      // Array methods (includes, indexOf, join)
      const arr = [c, a];
      const arrOps = {
        includesMatch: arr.includes(b),
        indexOfMatch: arr.indexOf(b),
        indexOfMiss: arr.indexOf("z".repeat(300)),
        joinedLen: [a, b].join("-").length,
      };

      // Object methods & computed keys
      const obj = { [a]: "hit", shared: a };
      const objOps = {
        computedRead: obj[b],
        keysOnStr: Object.keys(a),
        valsOnStr: Object.values(a),
        entsOnStr: Object.entries(a),
        valsSharedEq: Object.values({ k: a })[0] === b,
      };

      // JSON.stringify / JSON.parse
      const jsonStr = JSON.stringify({ x: a, y: a });
      const parsed = JSON.parse(jsonStr);
      const jsonOps = {
        jsonLen: jsonStr.length,
        roundTripEq: parsed.x === a && parsed.y === b,
      };

      // Host boundary: direct, object, array, and SafeBag writes
      params.bag.text = a;
      inspectHost(a, { nested: a }, [a], params.bag);

      // Return both direct long strings and nested structures
      ({
        typeOfA,
        eqStrict,
        eqLoose,
        rel,
        truthy,
        indexing,
        forOfCount,
        firstCh,
        sw,
        methods,
        arrOps,
        objOps,
        jsonOps,
        returnedStr: a,
        returnedArr: [b],
      });
    `,
      {
        params: { bag },
        inspectHost: (direct: unknown, objArg: any, arrArg: any, bagArg: any) => {
          hostSeen.push({
            directType: typeof direct,
            directLen: typeof direct === 'string' ? direct.length : -1,
            objType: typeof objArg?.nested,
            arrType: typeof arrArg?.[0],
            bagType: typeof bagArg?.text,
            bagLen: typeof bagArg?.text === 'string' ? bagArg.text.length : -1,
          })
          return 'ok'
        },
      },
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as any
    expect(Object.getPrototypeOf(val)).toBe(null)
    expect(val.typeOfA).toBe('string')
    expect(val.eqStrict).toEqual([true, false, false, true])
    expect(val.eqLoose).toEqual([true, true, true, 42, 42, 42])
    expect(val.rel).toEqual([true, true, true, true, true, true])
    expect(val.truthy).toEqual([true, false, 1, 7, true])
    expect(val.indexing).toEqual([300, 'a', 'a', undefined, 302, 'Z', '!'])
    expect(val.forOfCount).toBe(300)
    expect(val.firstCh).toBe('a')
    expect(val.sw).toBe('a')
    expect(val.methods).toEqual({
      sliceLen: 280,
      subLen: 270,
      idx: 300,
      lastIdx: 299,
      inc: true,
      starts: true,
      ends: true,
      trimLen: 300,
      trimStartLen: 302,
      trimEndLen: 302,
      upperEq: true,
      lowerEq: true,
      charAt0: 'a',
      repEq: true,
      repNoMatchEq: true,
      repAllEq: true,
      splitLens: [300, 300],
    })
    expect(val.arrOps).toEqual({
      includesMatch: true,
      indexOfMatch: 1,
      indexOfMiss: -1,
      joinedLen: 601,
    })
    expect(val.objOps).toEqual({
      computedRead: 'hit',
      keysOnStr: [],
      valsOnStr: [],
      entsOnStr: [],
      valsSharedEq: true,
    })
    expect(val.jsonOps).toEqual({
      jsonLen: JSON.stringify({ x: 'a'.repeat(300), y: 'a'.repeat(300) }).length,
      roundTripEq: true,
    })

    // Verify no boxed string ever leaked to host functions, SafeBag, or runMacroScript return value.
    expect(hostSeen).toEqual([
      {
        directType: 'string',
        directLen: 300,
        objType: 'string',
        arrType: 'string',
        bagType: 'string',
        bagLen: 300,
      },
    ])
    expect(typeof bag.text).toBe('string')
    expect(bag.text).toBe('a'.repeat(300))
    expect(typeof val.returnedStr).toBe('string')
    expect(val.returnedStr).toBe('a'.repeat(300))
    expect(typeof val.returnedArr[0]).toBe('string')
    expect(val.returnedArr[0]).toBe('a'.repeat(300))

    // Direct return of tracked string unwraps to plain string.
    const directRet = runMacroScript('"m".repeat(400);')
    expect(directRet.ok).toBe(true)
    if (directRet.ok) {
      expect(typeof directRet.value).toBe('string')
      expect(directRet.value).toBe('m'.repeat(400))
    }

    // Setting property on tracked string fails with type_error (non-object).
    const writeOnStr = runMacroScript('const s = "a".repeat(300); s.foo = 1;')
    expect(writeOnStr.ok).toBe(false)
    if (!writeOnStr.ok) {
      expect(writeOnStr.code).toBe('type_error')
    }

    // Circular return value containing a tracked string unwraps without stack overflow.
    const circRet = runMacroScript(`
      const o = { text: "c".repeat(300) };
      o.self = o;
      o;
    `)
    expect(circRet.ok).toBe(true)
    if (circRet.ok) {
      const cObj = circRet.value as any
      expect(Object.getPrototypeOf(cObj)).toBe(null)
      expect(typeof cObj.text).toBe('string')
      expect(cObj.text).toBe('c'.repeat(300))
      expect(cObj.self).toBe(cObj)
    }
  })

  it('rejects raw invisible and bidirectional control characters while allowing ASCII escapes', () => {
    expect(BIDI_AND_INVISIBLE_RE.test('\u202e')).toBe(true)
    expect(BIDI_AND_INVISIBLE_RE.test('\u200b')).toBe(true)
    expect(findDisallowedInvisibleChar('var x = 1;')).toBeNull()

    const bidiInComment = 'var a = 1;\n/* \u202e } */ a;'
    const found = findDisallowedInvisibleChar(bidiInComment)
    expect(found).toEqual({ line: 2, column: 4, codePoint: 0x202e, hex: '202E' })

    for (const src of [
      bidiInComment,
      '"\u202e"',
      'var o = {}; o["con\u200bstructor"]',
      'var x = 1; \u2066',
      'var x = 1; \u200f',
    ]) {
      const parsed = parseMacroScript(src)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) {
        expect(parsed.code).toBe('syntax_error')
        expect(parsed.error).toContain('U+')
      }
      const validated = validateMacroSyntax(src)
      expect(validated.ok).toBe(false)
    }

    // ASCII unicode escape sequence in string literal remains allowed and decodes normally.
    const asciiEscape = runMacroScript('"\\u202e"')
    expect(asciiEscape.ok).toBe(true)
    if (asciiEscape.ok) {
      expect(asciiEscape.value).toBe('\u202e')
    }
  })

  it('bounds expression and statement chain depth in MAX_PARSE_DEPTH without JS stack overflow', () => {
    const deepCases = [
      'var x = ' + Array(50_000).fill('1').join('+') + '; x',
      'var o = {}; o.a = o; var y = o' + '.a'.repeat(60_000) + '; 1',
      'function f(){ return f } f' + '()'.repeat(60_000) + '; 1',
      '!'.repeat(60_000) + 'true',
      '('.repeat(200) + '1' + ')'.repeat(200),
      '['.repeat(200) + ']'.repeat(200),
      'var x = ' + 'true ? 1 : '.repeat(20_000) + '0; x',
      'var a; a = ' + 'a = '.repeat(20_000) + '1; a',
      'var x = 0; ' + 'if (x) {} else '.repeat(500) + '{ x = 1 } x',
      'var x = ' + Array(300).fill('1').join(' && ') + '; x',
      'var x = ' + Array(300).fill('2').join(' ** ') + '; x',
    ]
    for (const src of deepCases) {
      const res = runMacroScript(src)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('syntax_error')
      }
    }
    // Oversized 20k else-if chain fails cleanly with script_too_large (zero stack overflow).
    const hugeElseIf = runMacroScript(
      'var x = 0; ' + 'if (x) {} else '.repeat(20_000) + '{ x = 1 } x',
    )
    expect(hugeElseIf.ok).toBe(false)
    if (!hugeElseIf.ok) {
      expect(['syntax_error', 'script_too_large']).toContain(hugeElseIf.code)
    }
  })

  it('re-checks time limit immediately after host calls return', () => {
    let clock = 1000
    const res = runMacroScript(
      'slowHost(); 1;',
      {
        slowHost: () => {
          clock += 500
          return 'done'
        },
      },
      { maxTimeMs: 100, now: () => clock },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('time_limit')
      expect(res.line).toBe(1)
    }
  })

  it('blocks security bypass regressions (computed/escaped keys, coercion hooks, callable methods, frozen host writes)', () => {
    const globals = {
      getObj: () => ({ a: 1, f: () => 2 }),
      o: Object.freeze(Object.assign(Object.create(null), { a: 1 })),
      arr: [1, 2, 3],
      hostFn: (x: unknown) => typeof x,
    }

    const forbiddenCases = [
      '""["const"+"ructor"]',
      'var o = {}; o[["constructor"]]',
      'var o = {}; o["\\x63onstructor"]',
      '""["\\u0063onstructor"]',
      'getObj()["constructor"]',
      'getObj().constructor',
      'JSON.parse(\'{"__proto__":{"p":1}}\')',
    ]
    for (const src of forbiddenCases) {
      const res = runMacroScript(src, globals)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('forbidden_property')
      }
    }
    expect(({} as Record<string, unknown>).p).toBeUndefined()

    // Escaped identifier property access must fail at parse time.
    const escapedIdent = runMacroScript('var o = {}; o.\\u0063onstructor', globals)
    expect(escapedIdent.ok).toBe(false)
    if (!escapedIdent.ok) {
      expect(escapedIdent.code).toBe('syntax_error')
    }

    // .call / .apply / .bind are not exposed on host, script, or builtin callables.
    const callableMeta = runMacroScript(
      `
      function localFn() { return 1; }
      [
        hostFn.call, hostFn.apply, hostFn.bind,
        localFn.call, localFn.apply, localFn.bind,
        Math.abs.call, Math.abs.apply, Math.abs.bind,
      ];
    `,
      globals,
    )
    expect(callableMeta.ok).toBe(true)
    if (callableMeta.ok) {
      expect(callableMeta.value).toEqual(Array(9).fill(undefined))
    }

    // Script valueOf / toString hooks are never invoked during coercion.
    const coercion = runMacroScript(`
      var called = 0;
      var obj = {
        valueOf: function () { called++; return 1; },
        toString: function () { called++; return "x"; },
      };
      var sum = obj + 1;
      var str = "" + obj;
      ({ called, isNaNSum: !Number.isFinite(sum), str });
    `)
    expect(coercion.ok).toBe(true)
    if (coercion.ok) {
      expect(coercion.value).toEqual({ called: 0, isNaNSum: true, str: '[object Object]' })
    }

    // Writes to frozen host objects, built-in namespaces, and host arrays fail cleanly.
    for (const src of ['o.a = 2;', 'Math.max = 1;', 'arr[0] = 5;']) {
      const res = runMacroScript(src, globals)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('type_error')
      }
    }
  })

  it('exports frozen INTERPRETER_CAPABILITIES matching actual dispatch tables', () => {
    expect(Object.isFrozen(INTERPRETER_CAPABILITIES)).toBe(true)
    expect(INTERPRETER_CAPABILITIES.globals).toEqual(
      expect.arrayContaining(['Math', 'Object', 'JSON', 'Number', 'String', 'Array', 'Boolean']),
    )
    expect(INTERPRETER_CAPABILITIES.keywords).toContain('switch')
    expect(INTERPRETER_CAPABILITIES.keywords).not.toContain('try')
    expect(INTERPRETER_CAPABILITIES.stringMethods).toContain('replaceAll')
    expect(INTERPRETER_CAPABILITIES.arrayMethods).toContain('reduce')
    expect(INTERPRETER_CAPABILITIES.objectMethods).toEqual(['keys', 'values', 'entries'])
    expect(INTERPRETER_CAPABILITIES.mathMethods).toContain('max')
    expect(INTERPRETER_CAPABILITIES.jsonMethods).toEqual(['stringify', 'parse'])
    expect(INTERPRETER_CAPABILITIES.numberMethods).toEqual(
      expect.arrayContaining(['isFinite', 'isInteger', 'parseInt', 'parseFloat']),
    )
  })
})
