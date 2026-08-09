import React from 'react';
import { Button } from '@/components/ui/button';
import { ShoppingBag, Lock } from 'lucide-react';

/**
 * BuyButton — sends the buyer to the Merchant of Record's own checkout page for this
 * walk's product. The MoR (Creem sandbox now, Paddle later) owns the checkout page, tax
 * collection, and payment; we just open the link the admin set on the walk.
 *
 * Disabled (with a lock) when no checkout URL is configured yet, so a walk can be listed
 * before its product is ready without linking to a dead page.
 */
export default function BuyButton({ walk, size = 'sm' }) {
  const url = walk?.checkout_url;
  const price = walk?.price_eur;

  const handleBuy = (e) => {
    e?.stopPropagation();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Button
      size={size}
      onClick={handleBuy}
      disabled={!url}
      className="gap-2 bg-amber-500 hover:bg-amber-600 text-white border-0"
    >
      {url ? <ShoppingBag className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
      {price ? `Buy · €${price}` : 'Buy'}
    </Button>
  );
}