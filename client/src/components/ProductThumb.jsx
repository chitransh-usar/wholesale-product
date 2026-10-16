import { useState } from "react";
import { Package } from "lucide-react";

/**
 * Small product image for table rows. Listing images are external URLs that
 * can rot, and a plain <img> with a dead src renders its alt text sprawling
 * across the cell. This falls back to a placeholder instead.
 */
const ProductThumb = ({ src, alt, className = "w-10 h-10" }) => {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div
        className={`${className} flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50`}
        aria-label={alt}
      >
        <Package className="h-4 w-4 text-slate-300" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${className} rounded-lg object-cover border border-slate-200`}
    />
  );
};

export default ProductThumb;
