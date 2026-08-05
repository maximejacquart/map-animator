/**
 * Pin — balise sobre, pas la goutte rouge de Google Maps.
 *
 * Un noyau plein cerclé de blanc, posé sur un halo doux : lisible sur une carte
 * claire. Le noyau porte le magenta Frenchtooth, seule couleur pleine de la
 * charte : c'est le point de marque de la vidéo. Dessiné en canvas 2D pour que
 * preview et export produisent exactement la même image.
 */

export const PIN_STYLE = {
  size: 96,          // diamètre du halo, en pixels de sortie
  ink: '#e12175',
  ring: '#ffffff',
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  position du point, en pixels de sortie
 * @param {number} y
 * @param {{opacity:number, scale:number, rise:number, pulse:number}} pinState
 *   issu de `pinAt(t)`
 */
export function drawPin(ctx, x, y, pinState, style = PIN_STYLE) {
  const { size, ink, ring } = style;
  const unit = size / 96; // les rayons ci-dessous sont exprimés sur une base 96

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, pinState.opacity));
  ctx.translate(x, y - pinState.rise * size);
  ctx.scale(pinState.scale * unit, pinState.scale * unit);

  const base = ctx.globalAlpha;

  // Onde qui s'échappe du pin une fois posé : elle tourne pendant tout le
  // palier final, l'arrivée ne se fige donc pas sur une image morte. Dessinée
  // en premier pour passer sous le pin, jamais par-dessus le noyau.
  if (pinState.pulse > 0) {
    const wave = pinState.pulse;
    ctx.globalAlpha = base * 0.34 * (1 - wave) ** 2;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    circle(ctx, 28 + wave * 30);
    ctx.stroke();
  }

  ctx.globalAlpha = base;
  ctx.fillStyle = ink;

  // Halo, puis disque intermédiaire : deux voiles très transparents.
  ctx.globalAlpha = base * 0.1;
  circle(ctx, 44);
  ctx.fill();

  ctx.globalAlpha = base * 0.14;
  circle(ctx, 30);
  ctx.fill();

  ctx.globalAlpha = base;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  circle(ctx, 30);
  ctx.stroke();

  // Noyau — seul élément à porter une ombre, sinon les voiles la doublent.
  ctx.shadowColor = 'rgba(20, 20, 60, .35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = ink;
  circle(ctx, 11);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  circle(ctx, 11);
  ctx.stroke();

  ctx.restore();
}

function circle(ctx, r) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
}
