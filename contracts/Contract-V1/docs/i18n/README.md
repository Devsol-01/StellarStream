# 🌐 Multi-Language Documentation

This directory hosts the StellarStream smart-contract documentation in multiple languages, so international developers can work with the protocol in their native language.

## Structure

```
docs/i18n/
├── README.md        # This file - explains the structure and contribution process
├── en/              # English (source of truth)
│   ├── USER_GUIDE.md
│   ├── INTEGRATION_GUIDE.md
│   └── API_REFERENCE.md
├── es/              # Spanish (Español)
│   ├── USER_GUIDE.md
│   ├── INTEGRATION_GUIDE.md
│   └── API_REFERENCE.md
├── zh/              # Chinese (中文)
│   ├── USER_GUIDE.md
│   ├── INTEGRATION_GUIDE.md
│   └── API_REFERENCE.md
└── ja/              # Japanese (日本語)
    ├── USER_GUIDE.md
    ├── INTEGRATION_GUIDE.md
    └── API_REFERENCE.md
```

## Supported Languages

| Language | Code | Status |
|----------|------|--------|
| English (source) | `en` | ✅ Complete |
| Spanish | `es` | ✅ Complete |
| Chinese | `zh` | ✅ Complete |
| Japanese | `ja` | ✅ Complete |

## Core Documents

Every language folder contains the same three documents, each covering one aspect of the protocol:

- **USER_GUIDE.md** — What StellarStream is, core concepts, the mathematical engine, security features, and how to use the protocol.
- **INTEGRATION_GUIDE.md** — Prerequisites, building, testing, deploying to testnet, advanced features, and production checklist.
- **API_REFERENCE.md** — Complete function catalog, data structures, and error reference.

## Conventions

- **English is the source of truth.** All translations mirror the English documents in `en/`. If a discrepancy is found, the English version is authoritative.
- **Code examples stay in English.** Rust code blocks are identical across languages; only the surrounding prose (and, where useful, comments inside code blocks) is translated.
- **Keep translations in sync.** When the English docs change, update all language folders in the same pull request. Untranslated sections should be marked with a `[TODO: translate]` note rather than silently omitted.

## Links Between Languages

Every document includes a language-switcher line at the top linking to the same document in the other available languages:

```markdown
**Languages:** [English](./USER_GUIDE.md) · [Español](../es/USER_GUIDE.md) · [中文](../zh/USER_GUIDE.md) · [日本語](../ja/USER_GUIDE.md)
```

When adding a new language, update these switcher lines in **all** existing documents.

## Translation Review

Translations are reviewed before merge:

1. **Technical review** — A maintainer verifies that the translation does not alter technical meaning (formulas, function names, error codes, addresses).
2. **Native-speaker review** — Each translation should be reviewed by at least one native speaker of the target language before it is considered final. Translations merged without a native-speaker review are marked as "pending review" in the language table above.
3. **Consistency check** — Terminology should stay consistent within a language. When you introduce a term, prefer reusing an established translation over inventing a new one.

## Contributing a Translation

1. **Check existing work** — Open an issue (or comment on an existing one) saying which language you want to translate, to avoid duplicate effort.
2. **Fork and branch** — Create a branch like `docs/translate-<language-code>`.
3. **Add a language folder** — Copy the structure from `en/` into `docs/i18n/<code>/` and translate each document.
4. **Update the links** — Add the new language to the language-switcher line in every document, and add a row to the language table in this README.
5. **Keep code in English** — Only translate prose and comments; leave Rust code blocks untouched.
6. **Open a pull request** — Reference the related issue, and mention whether a native speaker has reviewed the translation.

### Terminology Glossaries

When translating, keep these terms consistent:

| English | Note |
|---------|------|
| Stream | Payment stream created by the contract |
| Sender / Receiver | The two parties of a stream |
| Vesting | The unlock schedule over time |
| Cliff | Period with no unlocks before vesting begins |
| Withdraw | Pulling unlocked tokens out of the contract |
| Soulbound | Identity-locked stream that cannot be transferred |

## Requesting a New Language

Not seeing your language? Open an issue using the "Documentation" template and tag it with the `i18n` label. The fastest path is to contribute the translation yourself following the guide above.

---

*Built with ❤️ for the Stellar ecosystem.*
