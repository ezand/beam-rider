/**
 * A game's box as a 3D object: the front cover with a side for depth,
 * turned towards the wheel and slowly swaying, with a floor reflection. It
 * takes the cover's own shape, so landscape boxes (SNES, N64) stay whole.
 */

export type BoxArtProps = { src: string };

export function BoxArt({ src }: BoxArtProps) {
  return (
    <div className="box3d">
      <div className="box3d__object">
        <img className="box3d__front" src={src} alt="" draggable={false} />
        <div className="box3d__spine" style={{ backgroundImage: `url("${src}")` }} />
        <img className="box3d__reflection" src={src} alt="" draggable={false} />
      </div>
    </div>
  );
}
