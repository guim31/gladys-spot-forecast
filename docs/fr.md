# Spot Price Forecast

Prévision des prix spot de l'électricité pour les jours **au-delà** des prix
publiés, pour planifier le lave-linge, le chauffe-eau ou la recharge de la
voiture une semaine à l'avance.

La prévision vient de
[nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi) de
vividfog (licence MIT), un modèle ouvert d'apprentissage automatique qui prévoit
les prix day-ahead Nord Pool de la **Finlande** heure par heure, environ une
semaine à l'avance, à partir des prévisions météo, de l'éolien, de la
disponibilité du nucléaire et d'autres données.

Développée sans contrat d'électricité finlandais pour comparer : vos retours
sont les bienvenus. Sans lien avec Nord Pool ni avec l'auteur du modèle.

## Présentation

- Un appareil, **Prévision prix spot Finlande** : le prix prévu de l'heure en
  cours, la moyenne, le minimum et le maximum des 24 prochaines heures et des
  7 prochains jours, le début et le prix moyen de la plage d'heures
  consécutives la moins chère, la date de mise à jour de la prévision et
  jusqu'où elle va.
- Un widget de tableau de bord : la courbe prévue des 2, 4 ou 7 prochains jours.
- Deux déclencheurs de scène : les heures prévues les moins chères commencent,
  le prix prévu passe sous un seuil.
- Une action de scène : trouver les heures prévues les moins chères dans un
  délai donné.

Les prix sont en **€/kWh, TVA finlandaise comprise** (l'unité du modèle, en
centimes, divisée par 100), sans la marge du fournisseur ni le réseau.

C'est une **prévision**, pas les prix publiés : Nord Pool publie les vrais prix
du lendemain vers 14 h (Helsinki). Pour eux, utilisez une intégration Nord Pool
ou ENTSO-E à côté de celle-ci.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un accès à Internet depuis Gladys : la prévision est un fichier sur GitHub.
  Ni compte, ni clé.

## Installation

1. Dans Gladys, ouvrez **Intégrations → Installer depuis GitHub**.
2. Saisissez `https://github.com/guim31/gladys-spot-forecast`.
3. Ouvrez l'onglet **Découverte** de l'intégration et ajoutez l'appareil.
4. Ajoutez le widget **Prévision prix spot** à un tableau de bord.

## Configuration

- **Durée de la plage la moins chère** (1 à 8 heures, 3 par défaut) et
  **Chercher la plage la moins chère dans** (des 12 prochaines heures aux 7
  prochains jours, 24 heures par défaut) : la plage affichée par l'appareil.
- **Langue des noms de fonctionnalités** (français par défaut) : utilisée quand
  l'appareil est ajouté ; les noms ne changent plus ensuite.

## L'appareil de prévision

| Fonctionnalité                      | Signification                                                    |
| ----------------------------------- | ---------------------------------------------------------------- |
| Prix prévu maintenant (€/kWh)       | le prix prévu de l'heure en cours                                |
| Moyenne / Min / Max 24 h à venir    | sur les 24 heures à partir de l'heure en cours                   |
| Moyenne / Min / Max 7 jours à venir | sur les 168 heures à partir de l'heure en cours                  |
| Début de la plage la moins chère    | jour de la semaine et heure (Helsinki), par exemple `mar. 03:00` |
| Moyenne plage moins chère (€/kWh)   | le prix prévu moyen de cette plage                               |
| Prévision mise à jour / jusqu'au    | dernière publication du modèle, et fin de sa dernière heure      |

Les heures sont celles d'Helsinki, l'horloge des heures de prix finlandaises.

## Widget du tableau de bord

La courbe prévue (une marche par heure) des 2, 4 ou 7 prochains jours, avec ses
heures la plus basse et la plus haute ; trois tuiles (maintenant, moyenne des
24 prochaines heures et des 7 prochains jours) ; la plage la moins chère, la
mise à jour et la fin de la prévision. Les tuiles et les lignes d'état se
masquent dans les réglages du widget.

## Déclencheurs de scène

### Les heures prévues les moins chères commencent

Se déclenche quand commence la suite de N heures consécutives (1 à 8) la moins
chère des 12, 24 ou 48 prochaines heures : rien de moins cher n'est prévu avant
cet horizon. Ensuite, le même choix reste muet jusqu'à la fin de l'horizon :
avec des prix en baisse toute une journée, la plage la moins chère
commencerait sinon « maintenant » à chaque heure. Variables : prix moyen, début
et fin (HH:MM).

### Le prix prévu passe sous un seuil

Se déclenche au début d'une suite d'heures sous le seuil (0 à 0,20 €/kWh, TVA
comprise), quand l'heure d'avant était au-dessus. Variables : le prix de
l'heure, le nombre d'heures sous le seuil, début et fin (HH:MM).

## Action de scène

**Trouver les heures prévues les moins chères** : la suite de N heures
consécutives (1 à 8) la moins chère à partir de maintenant, dans les 6
prochaines heures à 7 prochains jours. Sorties : trouvée, commence maintenant,
date de début (AAAA-MM-JJ), début et fin (HH:MM), prix moyen, minutes avant le
début. Sans aucune prévision connue (source injoignable depuis le démarrage),
l'action échoue en rouge.

## Exemples de scènes

- **Chauffe-eau** : déclencheur « Les heures prévues les moins chères
  commencent » (3 heures, rien de moins cher dans les 24 prochaines heures) →
  allumer la prise du chauffe-eau ; une seconde scène l'éteint trois heures plus
  tard.
- **Recharge de la voiture** : chaque soir à 20 h, action « Trouver les heures
  prévues les moins chères » (4 heures dans les 48 heures) → envoyer un message
  « recharge le {start_date} à {start_time} ».
- **Prix négatifs** : déclencheur « Le prix prévu passe sous un seuil »
  (0 €/kWh) → notifier.

## Rafraîchissement et usage de la source

Le fichier est lu toutes les 30 minutes avec `If-None-Match` : s'il n'a pas
changé, GitHub répond 304 sans contenu. S'il a changé, un appel à l'API GitHub
(60 appels par heure et par adresse sans jeton) donne l'heure de son dernier
commit ; si GitHub refuse, l'heure à laquelle l'intégration a vu le changement
est affichée à la place. Après un échec, les essais suivants viennent après 5,
10, 20, 40 puis 60 minutes ; la dernière prévision lue reste utilisée en
attendant. Le modèle est relancé quelques fois par jour.

## Dépannage

- **L'intégration affiche un état d'erreur** : la prévision est illisible
  (GitHub injoignable), ou elle couvre moins d'une journée à venir (le modèle ne
  publie plus). La dernière prévision lue reste utilisée.
- **Aucun état sur l'appareil** : ajoutez l'appareil depuis l'onglet
  Découverte, puis utilisez l'action **Lire la prévision maintenant**.
- Tout le détail dans les journaux de l'intégration, avec `LOG_LEVEL=debug`.

## Limites

- **Finlande seulement** pour l'instant : aucune prévision ouverte sans clé n'a
  été trouvée pour la Suède ou l'Allemagne (novembre 2026). D'autres zones
  pourront s'ajouter comme appareils quand il en existera une.
- Une prévision n'est pas un prix : comptez plusieurs centimes d'erreur,
  davantage par grand vent ou grand froid. Le site du modèle montre sa précision
  passée.
- Prévision horaire, alors que le marché Nord Pool fonctionne au quart d'heure
  depuis octobre 2025.
- La prévision dépend d'un projet personnel hébergé sur GitHub : il peut
  s'arrêter.
