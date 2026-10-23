# Crédits

## Projet original

**FranceStudent IDE est un projet de [EsteG7](https://github.com/EsteG7)** : [dépôt original](https://github.com/EsteG7/francestudents-ide).

Ce dépôt est uniquement un fork d’amélioration maintenu par [extraopaa](https://github.com/extraopaa). Le crédit de la création revient à EsteG7 et aux contributeurs d’origine. L’historique Git et le champ `author` historique du paquet (Hecone) sont conservés.

Les améliorations de ce fork sont détaillées dans le [changelog](CHANGELOG.md). Ce fork n’est pas une version officielle du dépôt amont.

## Composants tiers

L’application utilise notamment Electron, CodeMirror, xterm.js, node-pty, Prettier, Marked, DOMPurify, Fuse.js, Lucide et electron-updater. Chaque composant conserve sa licence et son attribution.

EffectCraft (moteur de motion design web, v0.16.0, © 2026 ArtCraft Team and the EffectCraft contributors, licence MIT OR Apache-2.0) est intégré à l’onglet Motion design. Cette distribution modifiée reconstruit le moteur depuis [ses sources](https://github.com/storytold/effectcraft), à une révision épinglée. Le correctif `patches/effectcraft-francestudent.patch` adapte l’interface interne, les traductions et les espaces Simple / Avancé. `npm run vendor:effectcraft` produit le paquet local ; les licences et attributions d’origine sont conservées. Le binaire généré reste hors de Git.

Les licences embarquées sont accessibles dans **Cockpit → Raccourcis → Lire les licences**. Voir les [composants open source](docs/studio.md#composants-open-source).

Le paquet déclare ISC dans `package.json` ; aucun fichier `LICENSE` autonome n’est actuellement présent. Aucun nouveau texte de licence ou détenteur de droits n’est substitué à ceux du projet original.
