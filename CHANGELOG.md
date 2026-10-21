# Changelog

Historique du fork d’amélioration de **extraopaa**. **FranceStudent IDE est un projet de [EsteG7](https://github.com/EsteG7/francestudents-ide).** La numérotation du fork est indépendante des tags historiques du dépôt amont.

## [1.1.3] — 22 octobre 2026 · Navigateur local, images et pièces jointes

### Navigateur et interface

- Serveurs localhost ouverts dans un onglet Chromium indépendant, avec une barre inspirée du Simple Browser de VS Code : adresse, précédent/suivant, actualiser et ouverture externe.
- Ouverture depuis les liens du chat, du terminal et le champ d’adresse de l’ancien aperçu.
- Stockage local, appels API et WebSockets fonctionnels, même pour les pages refusant l’affichage en iframe.
- Message d’erreur et bouton Réessayer quand le serveur est indisponible ; retour aux onglets de code sans perdre leur contenu.
- Écran de démarrage du chat réorganisé : cartes alignées, icônes homogènes et actions de contexte lisibles.
- Enregistrement automatique du modèle par défaut à la sélection, avec confirmation dans les paramètres et conservation après redémarrage.

### Images et captures de l’agent

- Préparation commune des images avant téléversement, y compris les captures ouvertes par `view_image` : copie limitée à 6000 pixels par côté et 5 Mo, original conservé.
- Correction du refus Claude pour les captures dépassant 8000 pixels ; reprise textuelle possible si une ancienne image hors limites reste dans l’historique serveur.
- Dimensions et avertissement de lisibilité renvoyés à l’agent après réduction d’une capture.
- Avertissement pour les pièces jointes du chat fortement réduites ou compressées ; confirmation avant envoi avec conservation du brouillon en cas d’annulation.
- Arrêt des relances répétées pour les erreurs de requête définitives du fournisseur.

### File d’attente

- Prompts accompagnés de fichiers et d’images, modification des pièces jointes et affichage de leurs noms dans la file.
- Conservation locale des pièces jointes avec leur tâche après redémarrage, stockage séparé et borné.
- **Orienter** transmet aussi les fichiers à la prochaine étape de l’agent ; une consigne non transmise reste en attente si la tâche s’arrête.
- Nettoyage des fichiers liés lors du retrait d’une demande ou de l’effacement des tâches terminées.

### Distribution

- Validation : 562 tests unitaires réussis, 3 ignorés et 12 parcours Electron réussis. Démarrage et redimensionnement d’une grande capture vérifiés dans le paquet Windows.
- Installateur Windows x64, `.blockmap`, `latest.yml` et empreinte SHA-256 sur GitHub. Les versions portables restent exclusivement locales.
- Projet original de **EsteG7** ; cette version est une amélioration du fork maintenu par extraopaa.

## [1.1.2] — 22 octobre 2026 · Images et démarrage

- Correction du prompt d’agent qui excluait à tort les capacités d’image.
- Indication explicite des pièces jointes visuelles dans la requête, sans inventer de description si la vision est indisponible.
- Validation de l’UUID d’image renvoyé par le téléversement ; erreur visible plutôt qu’une pièce jointe invalide.
- Conservation des téléversements réussis en cas d’échec d’une image suivante.
- 26 tests ciblés validés, dont le parcours image, les relances et les appels en arrière-plan.
- Lecture réelle de deux images de contrôle vérifiée sur le modèle API `gpt-5.6-terra`, en chat puis avec le protocole Agent. Les autres modèles n’ont pas été vérifiés individuellement.
- Écran de chargement au démarrage avec vérification des mises à jour, bouton pour continuer et délai limité en cas de service indisponible.
- Recherche des versions publiées aussi en mode portable, sans installation automatique.
- Suppression du sélecteur Agent / Plan de la saisie : les demandes utilisent directement le mode Agent.
- Sept tests ciblés de mises à jour validés ; démarrage, vérification publique, bouton de passage et délai de secours vérifiés dans Electron.
- Publication GitHub limitée à l’installateur et aux fichiers de mise à jour ; portable exclusivement local. Le workflow applique désormais cette règle.

## [1.1.1] — Compaction automatique

### Ajouté

- Compaction automatique entre deux appels lorsque le contexte approche de son budget estimé.
- Résumé des consignes, décisions, fichiers, vérifications et travail restant, puis reprise automatique de la demande.
- Récupération par compaction après un refus explicite pour contexte trop long.
- Messages de progression ; historique affiché et prompts en attente conservés.

### Fiabilité

- Conversation conservée si le résumé échoue ou reste vide ; mémoire locale bornée.
- 25 tests ciblés validés : compaction, relances API, annulation et pièces jointes.
- Démarrage du paquet Windows 1.1.1 et présence du code de compaction vérifiés.

### Distribution

- Installateur NSIS Windows x64 et exécutable portable.
- `latest.yml` et `.blockmap` pour les mises à jour de la version installée.
- Empreintes des exécutables dans `SHA256SUMS.txt`.

### À savoir

Seuil par défaut : 80 % d’un budget estimé de 100 000 tokens, réglable par `FS_AUTO_COMPACT_TOKENS`. La fenêtre exacte dépend du modèle ; le service ne la fournit pas. Le suivi du volume repart au redémarrage. La mise à jour complète depuis une installation précédente n’a pas encore été validée de bout en bout sur une release publique.

## 1.1.0 — Agent, cockpit et interface

Version de travail locale précédant la première release publique du fork. Les évolutions sont regroupées sans reconstituer des dates de publication intermédiaires.

### Agent et autonomie

- File de prompts intégrée : édition, suppression, ordre, pause, reprise et orientation.
- Autorisations simplifiées, Full accès et avertissement visible.
- Scripts PowerShell, commandes en arrière-plan et arrêt des processus.
- Recherche autonome, sources, captures et lecture d’images selon le modèle.
- Plan de travail, activité et points de reprise des outils de fichiers.

### Espace de travail

- Cockpit : scripts, commandes personnalisées, sorties, diagnostics et outils locaux.
- Prettier, comparaison, aperçu Markdown et HTML local isolé.
- Symboles, préférences d’éditeur, enregistrement automatique, thèmes et repères.
- Inspection des formats non éditables ; encodages UTF-8 et UTF-16.

### Extensions et compte

- Bibliothèque de skills, profils, import et marketplace SkillsMP.
- Gestion des serveurs MCP stdio et de leurs outils.
- Paramètres recherchables, budgets de contexte, connexion guidée et déconnexion.
- Préparation des mises à jour via GitHub Releases pour la version installée.

## Origine

L’historique du [projet de EsteG7](https://github.com/EsteG7/francestudents-ide) est conservé. L’éditeur, le terminal, le CLI et les intégrations existantes proviennent de cette base.

[1.1.1]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.1
[1.1.2]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.2
[1.1.3]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.3
