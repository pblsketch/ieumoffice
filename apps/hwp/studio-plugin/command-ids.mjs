/**
 * The ids of the plugin's commands that build patches put into the studio's menus. They live
 * apart from agent-plugin.mjs so that the build script (scripts/rhwp-patches.mjs, run by plain
 * node) can name them without loading the plugin and what it imports.
 */

/** The command behind the right-click item 쉬운 말로 풀기 (studio-easy-words-context-menu). */
export const EASY_WORDS_COMMAND = 'ext:ieum-easy-words'

/** The command behind the right-click item 민감정보 가리기 (studio-hiding-context-menu). */
export const HIDING_COMMAND = 'ext:ieum-hide-sensitive'
