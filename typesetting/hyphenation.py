import hyphen
import uniseg.wordbreak

__all__ = ["hyphenate"]

SOFT_HYPHEN = "\N{SOFT HYPHEN}"


def hyphenate(text: str):
    hyphenator = hyphen.Hyphenator()
    words = []
    for word in uniseg.wordbreak.words(text):
        syllables = hyphenator.syllables(word) if len(word) < 100 else [word]
        if "".join(syllables) == word:
            words.append(SOFT_HYPHEN.join(syllables))
        else:
            words.append(word)
    return "".join(words)
