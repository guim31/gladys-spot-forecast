# Spot Price Forecast

Previsión de los precios spot de la electricidad para los días **posteriores** a
los precios publicados, para planificar la lavadora, el termo o la carga del
coche con una semana de antelación.

La previsión procede de
[nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi) de
vividfog (licencia MIT), un modelo abierto de aprendizaje automático que prevé
los precios day-ahead de Nord Pool para **Finlandia** hora a hora,
aproximadamente con una semana de antelación, a partir de las previsiones
meteorológicas, la eólica, la disponibilidad nuclear y otros datos.

Desarrollada sin un contrato de electricidad finlandés con el que comparar: sus
comentarios son bienvenidos. Sin relación con Nord Pool ni con el autor del
modelo.

## Presentación

- Un dispositivo, **Previsión precio spot Finlandia**: el precio previsto de la
  hora actual, la media, el mínimo y el máximo de las próximas 24 horas y de los
  próximos 7 días, el inicio y el precio medio del tramo de horas consecutivas
  más barato, cuándo se actualizó la previsión y hasta dónde llega.
- Un widget de panel: la curva prevista de los próximos 2, 4 o 7 días.
- Dos disparadores de escena: empiezan las horas previstas más baratas, el
  precio previsto baja de un umbral.
- Una acción de escena: buscar las horas previstas más baratas dentro de un
  plazo.

Los precios están en **€/kWh, IVA finlandés incluido** (la unidad del modelo,
céntimos, dividida entre 100), sin el margen de la comercializadora ni los
peajes.

Es una **previsión**, no los precios publicados: Nord Pool publica los precios
reales de mañana hacia las 14:00 (Helsinki). Para estos, use una integración
Nord Pool o ENTSO-E junto a esta.

## Requisitos

- Gladys Assistant 5.3.0 o posterior.
- Acceso a Internet desde Gladys: la previsión es un archivo en GitHub. Sin
  cuenta ni clave.

## Instalación

1. En Gladys, abra **Integraciones → Instalar desde GitHub**.
2. Introduzca `https://github.com/guim31/gladys-spot-forecast`.
3. Abra la pestaña **Descubrir** de la integración y añada el dispositivo.
4. Añada el widget **Previsión precio spot** a un panel.

## Configuración

- **Duración del tramo más barato** (1 a 8 horas, 3 por defecto) y **Buscar el
  tramo más barato en** (de las próximas 12 horas a los próximos 7 días, 24
  horas por defecto): el tramo que muestra el dispositivo.
- **Idioma de los nombres de las funciones** (francés por defecto): se usa
  cuando el dispositivo se añade; los nombres ya no cambian después.

## El dispositivo de previsión

| Función                                 | Significado                                                 |
| --------------------------------------- | ----------------------------------------------------------- |
| Precio previsto ahora (€/kWh)           | el precio previsto de la hora en curso                      |
| Media / Mínimo / Máximo próximas 24 h   | sobre las 24 horas desde la hora actual                     |
| Media / Mínimo / Máximo próximos 7 días | sobre las 168 horas desde la hora actual                    |
| Inicio del tramo más barato             | día de la semana y hora (Helsinki), por ejemplo `mar 03:00` |
| Media tramo más barato (€/kWh)          | el precio previsto medio de ese tramo                       |
| Previsión actualizada / Previsión hasta | última publicación del modelo, y fin de su última hora      |

Las horas están en la zona horaria de Helsinki, el reloj de las horas de precio
finlandesas.

## Widget del panel

La curva prevista (un escalón por hora) de los próximos 2, 4 o 7 días, con sus
horas más baja y más alta marcadas; tres mosaicos (ahora, media de las próximas
24 horas y de los próximos 7 días); el tramo más barato, la actualización y el
fin de la previsión. Los mosaicos y las líneas de estado se ocultan en los
ajustes del widget.

## Disparadores de escena

### Empiezan las horas previstas más baratas

Se dispara cuando empieza la serie de N horas consecutivas (1 a 8) más barata de
las próximas 12, 24 o 48 horas: no se prevé nada más barato antes de ese
horizonte. Después, la misma elección permanece en silencio hasta que termina
el horizonte: con precios bajando todo un día, el tramo más barato empezaría si
no «ahora» cada hora. Variables: precio medio, inicio y fin (HH:MM).

### El precio previsto baja de un umbral

Se dispara al inicio de una serie de horas por debajo del umbral (0 a
0,20 €/kWh, IVA incluido), cuando la hora anterior estaba por encima.
Variables: el precio de la hora, el número de horas por debajo del umbral,
inicio y fin (HH:MM).

## Acción de escena

**Buscar las horas previstas más baratas**: la serie de N horas consecutivas
(1 a 8) más barata desde ahora, dentro de las próximas 6 horas a 7 días.
Salidas: encontrado, empieza ahora, fecha de inicio (AAAA-MM-DD), inicio y fin
(HH:MM), precio medio, minutos hasta el inicio. Sin ninguna previsión conocida
(fuente inaccesible desde el arranque), la acción falla en rojo.

## Ejemplos de escenas

- **Termo**: disparador «Empiezan las horas previstas más baratas» (3 horas,
  nada más barato en las próximas 24 horas) → encender el enchufe del termo;
  una segunda escena lo apaga tres horas después.
- **Carga del coche**: cada tarde a las 20:00, acción «Buscar las horas
  previstas más baratas» (4 horas dentro de 48 horas) → enviar un mensaje
  «cargar el {start_date} a las {start_time}».
- **Precios negativos**: disparador «El precio previsto baja de un umbral»
  (0 €/kWh) → notificar.

## Actualización y uso de la fuente

El archivo se lee cada 30 minutos con `If-None-Match`: si no ha cambiado,
GitHub responde 304 sin contenido. Si ha cambiado, una llamada a la API de
GitHub (60 llamadas por hora y dirección sin token) da la hora de su último
commit; si GitHub la rechaza, se muestra en su lugar la hora a la que la
integración vio el cambio. Tras un fallo, los siguientes intentos llegan a los
5, 10, 20, 40 y luego 60 minutos; mientras tanto se sigue usando la última
previsión leída. El modelo se ejecuta varias veces al día.

## Solución de problemas

- **La integración muestra un estado de error**: la previsión no se puede leer
  (GitHub inaccesible) o cubre menos de un día por delante (el modelo ya no
  publica). Se sigue usando la última previsión leída.
- **Ningún estado en el dispositivo**: añada el dispositivo desde la pestaña
  Descubrir y use la acción **Leer la previsión ahora**.
- Todo el detalle en los registros de la integración, con `LOG_LEVEL=debug`.

## Limitaciones

- **Solo Finlandia** por ahora: no se encontró ninguna previsión abierta sin
  clave para Suecia o Alemania (noviembre de 2026). Otras zonas podrán añadirse
  como dispositivos cuando exista una.
- Una previsión no es un precio: cuente con errores de varios céntimos, más con
  mucho viento o mucho frío. El sitio del modelo muestra su precisión pasada.
- Previsión horaria, mientras que el mercado Nord Pool funciona por cuartos de
  hora desde octubre de 2025.
- La previsión depende de un proyecto personal alojado en GitHub: puede
  detenerse.
