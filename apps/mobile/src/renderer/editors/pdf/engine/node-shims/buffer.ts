/**
 * Stand-in for the `Buffer` global (and `node:buffer`) inside the PC PDF save
 * code on the phone: the `buffer` package. The build injects it into those
 * modules only.
 */
import { Buffer } from 'buffer'

export { Buffer }
export default { Buffer }
