/* @flow */

import { isObject, isPlainObject, hasOwn } from './util'

/**
 *  Path paerser
 *  - Inspired:
 *    Vue.js Path parser
 */

// cache
const pathCache = Object.create(null)

// actions
const APPEND = 0
const PUSH = 1
const INC_SUB_PATH_DEPTH = 2
const PUSH_SUB_PATH = 3

// states
const BEFORE_PATH = 0
const IN_PATH = 1
const BEFORE_IDENT = 2
const IN_IDENT = 3
const IN_SUB_PATH = 4
const IN_SINGLE_QUOTE = 5
const IN_DOUBLE_QUOTE = 6
const AFTER_PATH = 7
const ERROR = 8

const pathStateMachine: any = []

pathStateMachine[BEFORE_PATH] = {
  'ws': [BEFORE_PATH],
  'ident': [IN_IDENT, APPEND],
  '[': [IN_SUB_PATH],
  'eof': [AFTER_PATH]
}

pathStateMachine[IN_PATH] = {
  'ws': [IN_PATH],
  '.': [BEFORE_IDENT],
  '[': [IN_SUB_PATH],
  'eof': [AFTER_PATH]
}

pathStateMachine[BEFORE_IDENT] = {
  'ws': [BEFORE_IDENT],
  'ident': [IN_IDENT, APPEND],
  '0': [IN_IDENT, APPEND],
  'number': [IN_IDENT, APPEND]
}

pathStateMachine[IN_IDENT] = {
  'ident': [IN_IDENT, APPEND],
  '0': [IN_IDENT, APPEND],
  'number': [IN_IDENT, APPEND],
  'ws': [IN_PATH, PUSH],
  '.': [BEFORE_IDENT, PUSH],
  '[': [IN_SUB_PATH, PUSH],
  'eof': [AFTER_PATH, PUSH]
}

pathStateMachine[IN_SUB_PATH] = {
  "'": [IN_SINGLE_QUOTE, APPEND],
  '"': [IN_DOUBLE_QUOTE, APPEND],
  '[': [IN_SUB_PATH, INC_SUB_PATH_DEPTH],
  ']': [IN_PATH, PUSH_SUB_PATH],
  'eof': ERROR,
  'else': [IN_SUB_PATH, APPEND]
}

pathStateMachine[IN_SINGLE_QUOTE] = {
  "'": [IN_SUB_PATH, APPEND],
  'eof': ERROR,
  'else': [IN_SINGLE_QUOTE, APPEND]
}

pathStateMachine[IN_DOUBLE_QUOTE] = {
  '"': [IN_SUB_PATH, APPEND],
  'eof': ERROR,
  'else': [IN_DOUBLE_QUOTE, APPEND]
}

/**
 * Check if an expression is a literal value.
 */

const literalValueRE: RegExp = /^\s?(true|false|-?[\d.]+|'[^']*'|"[^"]*")\s?$/
function isLiteral (exp: string): boolean {
  return literalValueRE.test(exp)
}

/**
 * Strip quotes from a string
 */

function stripQuotes (str: string): string | boolean {
  const a: number = str.charCodeAt(0)
  const b: number = str.charCodeAt(str.length - 1)
  return a === b && (a === 0x22 || a === 0x27)
    ? str.slice(1, -1)
    : str
}

/**
 * Determine the type of a character in a keypath.
 */

function getPathCharType (ch: ?string): string {
  if (ch === undefined || ch === null) { return 'eof' }

  const code: number = ch.charCodeAt(0)

  switch (code) {
    case 0x5B: // [
    case 0x5D: // ]
    case 0x2E: // .
    case 0x22: // "
    case 0x27: // '
    case 0x30: // 0
      return ch

    case 0x5F: // _
    case 0x24: // $
    case 0x2D: // -
      return 'ident'

    case 0x20: // Space
    case 0x09: // Tab
    case 0x0A: // Newline
    case 0x0D: // Return
    case 0xA0:  // No-break space
    case 0xFEFF:  // Byte Order Mark
    case 0x2028:  // Line Separator
    case 0x2029:  // Paragraph Separator
      return 'ws'
  }

  // a-z, A-Z
  if ((code >= 0x61 && code <= 0x7A) || (code >= 0x41 && code <= 0x5A)) {
    return 'ident'
  }

  // 1-9
  if (code >= 0x31 && code <= 0x39) { return 'number' }

  return 'else'
}

/**
 * Format a subPath, return its plain form if it is
 * a literal string or number. Otherwise prepend the
 * dynamic indicator (*).
 */

function formatSubPath (path: string): boolean | string {
  const trimmed: string = path.trim()
  // invalid leading 0
  if (path.charAt(0) === '0' && isNaN(path)) { return false }

  return isLiteral(trimmed) ? stripQuotes(trimmed) : '*' + trimmed
}

/**
 * Parse a string path into an array of segments
 */

function parse (path): ?Array<string> {
  const keys: Array<string> = []
  let index: number = -1
  let mode: number = BEFORE_PATH
  let subPathDepth: number = 0
  let c: ?string
  let key: any
  let newChar: any
  let type: string
  let transition: number
  let action: Function
  let typeMap: any
  const actions: Array<Function> = []

  actions[PUSH] = function () {
    if (key !== undefined) {
      keys.push(key)
      key = undefined
    }
  }

  actions[APPEND] = function () {
    if (key === undefined) {
      key = newChar
    } else {
      key += newChar
    }
  }

  actions[INC_SUB_PATH_DEPTH] = function () {
    actions[APPEND]()
    subPathDepth++
  }

  actions[PUSH_SUB_PATH] = function () {
    if (subPathDepth > 0) {
      subPathDepth--
      mode = IN_SUB_PATH
      actions[APPEND]()
    } else {
      subPathDepth = 0
      key = formatSubPath(key)
      if (key === false) {
        return false
      } else {
        actions[PUSH]()
      }
    }
  }

  function maybeUnescapeQuote (): ?boolean {
    const nextChar: string = path[index + 1]
    if ((mode === IN_SINGLE_QUOTE && nextChar === "'") ||
      (mode === IN_DOUBLE_QUOTE && nextChar === '"')) {
      index++
      newChar = '\\' + nextChar
      actions[APPEND]()
      return true
    }
  }

  while (mode !== null) {
    index++
    c = path[index]

    if (c === '\\' && maybeUnescapeQuote()) {
      continue
    }

    type = getPathCharType(c)
    typeMap = pathStateMachine[mode]
    transition = typeMap[type] || typeMap['else'] || ERROR

    if (transition === ERROR) {
      return // parse error
    }

    mode = transition[0]
    action = actions[transition[1]]
    if (action) {
      newChar = transition[2]
      newChar = newChar === undefined
        ? c
        : newChar
      if (action() === false) {
        return
      }
    }

    if (mode === AFTER_PATH) {
      return keys
    }
  }
}

/**
 * External parse that check for a cache hit first
 */

function parsePath (path: string): Array<string> {
  let hit: ?Array<string> = pathCache[path]
  if (!hit) {
    hit = parse(path)
    if (hit) {
      pathCache[path] = hit
    }
  }
  return hit || []
}

export type PathValue = | string | number | boolean | null | PathValueObject | PathValueArray
export type PathValueObject = Dictionary<PathValue>
export type PathValueArray = Array<PathValue>

function empty (target: any): boolean {
  if (target === null || target === undefined) { return true }

  if (Array.isArray(target)) {
    if (target.length > 0) { return false }
    if (target.length === 0) { return true }
  } else if (isPlainObject(target)) {
    /* eslint-disable prefer-const */
    for (let key in target) {
      if (hasOwn(target, key)) { return false }
    }
    /* eslint-enable prefer-const */
  }

  return true
}

/**
 * Get path value from path string
 */
export default function getPathValue (obj: Object, path: string): PathValue {
  if (!isObject(obj)) { return null }

  const paths: Array<string> = parsePath(path)
  if (empty(paths)) {
    return null
  } else {
    const length = paths.length
    let ret: any = null
    let last: any = obj
    let i = 0
    while (i < length) {
      const value: any = last[paths[i]]
      if (value === undefined) {
        last = null
        break
      }
      last = value
      i++
    }

    ret = last
    return ret
  }
}
