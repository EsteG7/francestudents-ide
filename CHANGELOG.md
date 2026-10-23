# Changelog

Historique du fork d’amélioration de **extraopaa**. **FranceStudent IDE est un projet de [EsteG7](https://github.com/EsteG7/francestudents-ide).** La numérotation du fork est indépendante des tags historiques du dépôt amont.

## [1.3.1] — 23 octobre 2026 · Sélection de skills motion design

- Nouvel onglet Motion design dans le centre d’extensions, accessible aussi par le bouton Skills d’EffectCraft. Le marketplace code SkillsMP reste séparé et conserve sa recherche habituelle.
- Huit skills natifs hors ligne : titres, logos, transitions, mouvements fluides, réseaux sociaux, infographies, sous-titres et export.
- Cinq skills de la collection officielle Remotion, sélectionnés selon les installations affichées sur Skills.sh au 23 octobre 2026 : bases, rendu, création, sous-titres et animation/mise en page. Source du classement et compatibilité affichées.
- Import Remotion avec ses ressources annexes, depuis une archive épinglée et vérifiée par SHA-256. Aperçu obligatoire, annulation et installation désactivée conservés. La recherche SkillsMP habituelle importe toujours seulement le SKILL.md.
- Catalogues de l’agent adaptés au moteur : EffectCraft dans le chat motion, Remotion dans le chat code. Aucun skill n’est installé automatiquement.

## [1.3.0] — 23 octobre 2026 · EffectCraft piloté par le chat motion design

- Remplacement du studio canvas natif par le véritable éditeur EffectCraft 0.16.0, reconstruit depuis une révision épinglée avec une interface interne adaptée à FranceStudent. Sources des modifications et procédure de compilation incluses.
- Mode Simple par défaut : quatre outils lisibles, une grande composition et une timeline allégée. Le bouton Avancé retrouve les panneaux et outils complets. Palette, espacements et traductions des panneaux harmonisés avec l’IDE.
- Trois petits tutos : premier titre, mouvement, enregistrement et export. Ils préparent une demande modifiable sans déclencher l’IA ni consommer de quota.
- Chat spécialisé dans l’animation, consignes accessibles aux débutants, actions lisibles et contexte de code exclu des demandes motion.
- Interface harmonisée : thème sombre EffectCraft, en-tête compact, contrôles Lecture / Arrêter / Annuler / Enregistrer, éditeur sur toute la hauteur disponible, chat à droite.
- Conversations, modèles, brouillons et exports de conversation distincts entre code et motion design. Une tâche ou des demandes en attente doivent être terminées avant de changer de chat.
- Outil `effectcraft` pour l’agent : inspection, découverte des schémas de commandes, compositions, calques, textes, propriétés, keyframes, effets, lecture et rendus PNG consultables avec `view_image`. Les confirmations habituelles s’appliquent aux modifications ; Full accès reste disponible.
- Enregistrer sauvegarde dans le stockage local d’EffectCraft. Origine locale stable entre lancements pour retrouver ce stockage ; fermer l’onglet conserve le moteur et le projet ouvert. Le menu File d’EffectCraft permet les imports et copies de projet.
- Compatibilité WebGL activée pour éviter la perte de périphérique WebGPU constatée dans Electron. Les rendus lourds peuvent être plus lents ; l’intégration reste en bêta.
- Vérification du terminal PowerShell et du véritable moteur dans le paquet Windows 1.3.0. Test Electron avec des réponses IA contrôlées : création de composition, ajout d’un titre, rendu PNG, sauvegarde, modes Simple / Avancé, tutos et conservation du projet au retour dans l’onglet.

## [1.2.1] — 22 octobre 2026 · Studio motion design natif et message de budget épuisé

- Onglet **Motion design** : nouveau studio natif qui ne dépend plus d’EffectCraft. Il s’appuie sur un moteur sans DOM (easings, interpolation de keyframes, presets) couvert par des tests automatiques. Le rendu et l’ergonomie dans l’IDE n’ont pas encore été vérifiés visuellement.
- Message « budget de chat épuisé » (HTTP 429) : au lieu du texte brut avec le JSON de l’erreur, l’IDE affiche une carte intégrée au thème avec l’heure de reprise en heure de Paris, le temps restant et un bloc « Détails techniques » replié. Le CLI et le terminal affichent toujours le message d’origine.
- Limites : 4 tests automatiques étaient déjà en échec avant cette version (runCommand cd/cwd, policy denialReason, 2 confirmations desktop-backend). L’installateur n’est pas signé.

## [1.2.0] — 22 octobre 2026 · Motion design EffectCraft et images moins coûteuses

- Nouvel onglet **Motion design** : intégration d’EffectCraft v0.14.0 (version alpha), chargé depuis `desktop/vendor-effectcraft`. Ce dossier n’est pas versionné ; il se télécharge avec `npm run vendor:effectcraft`. Le rendu WebGPU dans Electron et le pilotage de la timeline ne sont pas encore vérifiés.
- Images jointes : elles ne sont plus renvoyées automatiquement à chaque requête de la même conversation. Toutes les cinq requêtes, l’agent est interrogé (sans images ni outils) pour savoir s’il se souvient encore des images ; en cas de réponse négative, d’hésitation ou d’erreur, elles sont renvoyées. Le découpage en lots de quatre images n’a pas changé.
- Crédits mis à jour pour EffectCraft.
- Limites : la mémoire des images dépend du modèle et du fournisseur ; la question de contrôle consomme une petite requête.

## [1.1.7] — 22 octobre 2026 · Interface harmonisée et connecteur GitHub bêta

- Refonte visuelle de l’espace de travail : couleurs, espacements, boutons, navigation, accueil, chat, cartes, dialogues et panneaux cohérents. Meilleure adaptation aux petites fenêtres.
- Catégories dans les paramètres, recherche dans toutes les sections et focus clavier visible.
- Désinstallation accessible depuis la bibliothèque et les skills installés, avec confirmation et conservation dans `.trash`. Les connexions MCP peuvent être retirées ; leur programme externe n’est pas désinstallé.
- Téléchargements de skills : progression réelle en octets, annulation et nouvelle tentative. Les instructions restent consultables avant installation, désactivées par défaut pour les skills communautaires.
- Connecteur GitHub **Bêta** : consultation des dépôts, issues, PR et releases ; brouillons de release, ajout de fichiers et publication explicite. L’agent peut lire et modifier des fichiers distants, créer des commits avec une liste de fichiers, pousser, créer des PR et des issues selon les permissions du token.
- Full accès : bouton d’annulation par action, sans nouvelle confirmation systématique et sans arrêter toute la tâche. Annulation des modifications suivies disponible après l’action ; les effets de commandes ou opérations distantes déjà terminées ne sont pas automatiquement réversibles.
- Images conservées dans les requêtes suivantes de la même conversation, du même modèle et du même projet, jusqu’à quatre images récentes. Les envois en lots conservent les observations visuelles et joignent les quatre dernières images à la demande finale. La vision reste dépendante du modèle et du fournisseur ; renvoyer les images peut consommer du quota.

## [1.1.6] — 22 octobre 2026 · Boutons et suivi de consommation

- Boutons de conversation redessinés : icônes cohérentes, badge Bêta séparé, état du mode Éco et disposition adaptée à la largeur du panneau.
- Jauge de quota cliquable et nouvel onglet Usage avec quota restant, réinitialisation et limites du compte.
- Compteurs de requêtes et tokens de session, avec distinction entre estimations et relevés réels.
- Consultation et actualisation de l’usage pendant une tâche, sans lancer de génération IA ni perdre le brouillon.

## [1.1.5] — 22 octobre 2026 · Liens partagés Codex

- Reconnaissance du format de partage Codex `https://chatgpt.com/s/cx_…`.
- Lecture de l’instantané public chargé par la page, au lieu de rechercher la conversation dans un HTML vide.
- Import des messages utilisateur, commentaires et réponses de l’agent dans l’ordre, sans appliquer les différences de fichiers ni importer les résumés internes.
- Exemple de lien et documentation de l’import actualisés. Correction vérifiée sur un lien réel et couverte par un test de régression.

## [1.1.4] — 22 octobre 2026 · Fichiers, mode Éco et reprise de conversation

- Prise en charge élargie des fichiers : PDF, SVG, documents Office, présentations, tableaux, archives et extraction de contenu avec signalement des limites.
- Glisser-déposer et pièces jointes nombreuses envoyées en lots ; avertissement de quota dès cinq fichiers.
- Mode Éco avec explication avant activation, contexte automatique réduit et agent limité à quatre tours.
- Import de conversation Codex en bêta pour continuer dans le projet déjà ouvert avec un autre modèle.
- Historique repositionné dans la fenêtre, noms des modèles et confirmation de suppression désactivable.
- Boutons Démarrer, Arrêter et Ouvrir le site dans les réponses contenant une commande de serveur local reconnue.
- Récupération des appels d’outils locaux rejetés par le backend et diagnostics réseau plus précis.
- Compaction du contexte adaptée au modèle sélectionné.
- Choix de mise à jour au démarrage et README simplifié, accompagné d’un guide avancé.

Installateur Windows x64 avec les fichiers nécessaires aux mises à jour. Les versions portables restent locales.

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
[1.1.6]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.6
[1.1.5]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.5
[1.1.4]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.4
[1.1.3]: https://github.com/extraopaa/francestudents-ide/releases/tag/v1.1.3
