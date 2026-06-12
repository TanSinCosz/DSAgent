export const MAX_FILE_READ_TOKENS = 25000

export interface Tokenizer {
    encode(text: string): number[] | { length: number }
}

export function countTokensWithTokenizer(
    content: string,
    tokenizer: Tokenizer,
): number {
    const encoded = tokenizer.encode(content)
    return Array.isArray(encoded) ? encoded.length : encoded.length
}

function estimateTokenCount(content: string): number {
    if (!content) {
        return 0
    }

    const asciiChars = content.replace(/[^\x00-\x7F]/g, "").length
    const nonAsciiChars = content.length - asciiChars

    // A conservative fallback: English-like text averages ~4 chars/token,
    // while CJK text is closer to 1 char/token.
    return Math.ceil(asciiChars / 4 + nonAsciiChars)
}

export function validateContentTokens(
    content: string,
    tokenizer?: Tokenizer,
    maxTokens = MAX_FILE_READ_TOKENS,
): void {
    const tokenCount = tokenizer
        ? countTokensWithTokenizer(content, tokenizer)
        : estimateTokenCount(content)

    if (tokenCount > maxTokens) {
        throw new Error(
            `File content (${tokenCount} tokens) exceeds maximum allowed tokens (${maxTokens}). Use offset and limit to read specific portions of the file.`,
        )
    }
}
