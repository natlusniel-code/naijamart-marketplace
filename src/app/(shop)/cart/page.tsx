import { CartView } from "@/components/cart-view";

export const metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <div>
      <h1 className="mb-4 text-[22px] font-extrabold tracking-tight text-ink-900">Your cart</h1>
      <CartView />
    </div>
  );
}
