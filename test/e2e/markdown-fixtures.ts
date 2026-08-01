export function withoutFencedCode(markdown: string): string {
  let fence: { character: '`' | '~'; length: number } | null = null;
  return markdown
    .split('\n')
    .filter(line => {
      if (fence) {
        const closingFence = line.match(/^ {0,3}(`+|~+)\s*$/)?.[1];
        if (closingFence?.[0] === fence.character && closingFence.length >= fence.length) {
          fence = null;
        }
        return false;
      }

      const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
      if (openingFence) {
        fence = {
          character: openingFence[0] as '`' | '~',
          length: openingFence.length,
        };
        return false;
      }
      return true;
    })
    .join('\n');
}
