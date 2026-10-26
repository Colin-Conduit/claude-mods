// Conduit change: types for platform.mjs, so its test type-checks.
import type { EngineInterface } from 'claude-code'

type Host = Pick<EngineInterface, 'plugin' | 'process'>

export declare const isWindows: (root: string) => boolean
export declare const homeOf: (root: string) => string
export declare function removeFile($: Host, path: string): Promise<void>
