import { GREP_TOOL_NAME } from "../Grep/prompt.js";
import { GLOB_TOOL_NAME } from "../Glob/prompt.js";
import { FILE_READ_TOOL_NAME } from "../FileRead/prompt.js";
import { FILE_EDIT_TOOL_NAME } from "../FileEdit/prompt.js";
import { FILE_WRITE_TOOL_NAME } from "../FileWrite/prompt.js";
export const BASH_TOOL_NAME = 'Bash'


export function getSimplePrompt(): string {
    // Ant-native builds alias find/grep to embedded bfs/ugrep in Claude's shell,
    // so we don't steer away from them (and Glob/Grep tools are removed).
    const embedded = hasEmbeddedSearchTools()

    const toolPreferenceItems = [
        ...(embedded
            ? []
            : [
                `File search: Use ${GLOB_TOOL_NAME} (NOT find or ls)`,
                `Content search: Use ${GREP_TOOL_NAME} (NOT grep or rg)`,
            ]),
        `Read files: Use ${FILE_READ_TOOL_NAME} (NOT cat/head/tail)`,
        `Edit files: Use ${FILE_EDIT_TOOL_NAME} (NOT sed/awk)`,
        `Write files: Use ${FILE_WRITE_TOOL_NAME} (NOT echo >/cat <<EOF)`,
        'Communication: Output text directly (NOT echo/printf)',
    ]

    const avoidCommands = embedded
        ? '`cat`, `head`, `tail`, `sed`, `awk`, or `echo`'
        : '`find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo`'

    const multipleCommandsSubitems = [
        `If the commands are independent and can run in parallel, make multiple ${BASH_TOOL_NAME} tool calls in a single message. Example: if you need to run "git status" and "git diff", send a single message with two ${BASH_TOOL_NAME} tool calls in parallel.`,
        `If the commands depend on each other and must run sequentially, use a single ${BASH_TOOL_NAME} call with '&&' to chain them together.`,
        "Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.",
        'DO NOT use newlines to separate commands (newlines are ok in quoted strings).',
    ]

    const gitSubitems = [
        'Prefer to create a new commit rather than amending an existing commit.',
        'Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.',
        'Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.',
    ]

    const sleepSubitems = [
        'Do not sleep between commands that can run immediately — just run them.',
        ...(feature('MONITOR_TOOL')
            ? [
                'Use the Monitor tool to stream events from a background process (each stdout line is a notification). For one-shot "wait until done," use Bash with run_in_background instead.',
            ]
            : []),
        'If your command is long running and you would like to be notified when it finishes — use `run_in_background`. No sleep needed.',
        'Do not retry failing commands in a sleep loop — diagnose the root cause.',
        'If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll.',
        ...(feature('MONITOR_TOOL')
            ? [
                '`sleep N` as the first command with N ≥ 2 is blocked. If you need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.',
            ]
            : [
                'If you must poll an external process, use a check command (e.g. `gh run view`) rather than sleeping first.',
                'If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.',
            ]),
    ]
    const backgroundNote = getBackgroundUsageNote()

    const instructionItems: Array<string | string[]> = [
        'If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists and is the correct location.',
        'Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")',
        'Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.',
        `You may specify an optional timeout in milliseconds (up to ${getMaxTimeoutMs()}ms / ${getMaxTimeoutMs() / 60000} minutes). By default, your command will timeout after ${getDefaultTimeoutMs()}ms (${getDefaultTimeoutMs() / 60000} minutes).`,
        ...(backgroundNote !== null ? [backgroundNote] : []),
        'When issuing multiple commands:',
        multipleCommandsSubitems,
        'For git commands:',
        gitSubitems,
        'Avoid unnecessary `sleep` commands:',
        sleepSubitems,
        ...(embedded
            ? [
                // bfs (which backs `find`) uses Oniguruma for -regex, which picks the
                // FIRST matching alternative (leftmost-first), unlike GNU find's
                // POSIX leftmost-longest. This silently drops matches when a shorter
                // alternative is a prefix of a longer one.
                "When using `find -regex` with alternation, put the longest alternative first. Example: use `'.*\\.\\(tsx\\|ts\\)'` not `'.*\\.\\(ts\\|tsx\\)'` — the second form silently skips `.tsx` files.",
            ]
            : []),
    ]

    return [
        'Executes a given bash command and returns its output.',
        '',
        "The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).",
        '',
        `IMPORTANT: Avoid using this tool to run ${avoidCommands} commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:`,
        '',
        ...prependBullets(toolPreferenceItems),
        `While the ${BASH_TOOL_NAME} tool can do similar things, it’s better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.`,
        '',
        '# Instructions',
        ...prependBullets(instructionItems),
        getSimpleSandboxSection(),
        ...(getCommitAndPRInstructions() ? ['', getCommitAndPRInstructions()] : []),
    ].join('\n')
}

