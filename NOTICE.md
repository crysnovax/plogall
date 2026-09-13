# PLOGALL dependency notices

PLOGALL is a new orchestration project. Its adapters preserve native engine boundaries and do not rename, rewrite, or redistribute the platform engines.

## WhatsApp engine

The WhatsApp adapter targets the published `plogme` package, the selected Crysnovax Baileys-based engine. PLOGALL does not attempt to rebrand it; its original package identity, attribution, and license remain intact:

- Repository: https://github.com/crysnovax/baileys
- Attribution required by the engine license: **Based on @crysnovax/baileys by Crysnovax**
- The engine's Crysnovax Source License v1.0 remains applicable to any installed or redistributed engine code.

## Telegram engine

The Telegram adapter targets the published `tgplus` public `Bot`, `Context`, and `Api` APIs at version `1.0.0`:

- npm: https://www.npmjs.com/package/tgplus
- Repository: https://github.com/crysnovax/TGplus
- License: MIT, as declared by the published package

PLOGALL does not claim ownership of either engine and keeps both as external dependencies outside the platform-neutral core.
