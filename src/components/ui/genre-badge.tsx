import type { IconType } from 'react-icons';
import {
  MdBookmark,
  MdCardGiftcard,
  MdChildCare,
  MdCoffee,
  MdCreditCard,
  MdDevices,
  MdDirectionsTransit,
  MdFlight,
  MdHelpOutline,
  MdHome,
  MdLocalBar,
  MdLocalGroceryStore,
  MdLocalHospital,
  MdMenuBook,
  MdMovie,
  MdPets,
  MdPhoneAndroid,
  MdPayments,
  MdRestaurant,
  MdSell,
  MdShoppingBasket,
  MdSpa,
  MdBolt,
  MdCheckroom,
} from 'react-icons/md';

import { genreColorVar, genreStyle, type GenreIconKey } from '@/domain/genre-style';

const ICONS: Record<GenreIconKey, IconType> = {
  grocery: MdLocalGroceryStore,
  restaurant: MdRestaurant,
  cafe: MdCoffee,
  bar: MdLocalBar,
  goods: MdShoppingBasket,
  fashion: MdCheckroom,
  beauty: MdSpa,
  health: MdLocalHospital,
  home: MdHome,
  utility: MdBolt,
  phone: MdPhoneAndroid,
  transport: MdDirectionsTransit,
  hobby: MdMovie,
  book: MdMenuBook,
  subscription: MdCreditCard,
  gift: MdCardGiftcard,
  kids: MdChildCare,
  pet: MdPets,
  appliance: MdDevices,
  travel: MdFlight,
  money: MdPayments,
  other: MdSell,
  uncategorized: MdHelpOutline,
};

export function GenreIcon({ name, size = 16 }: { name: string | null; size?: number }) {
  const Icon = ICONS[genreStyle(name).icon] ?? MdBookmark;
  return <Icon aria-hidden size={size} />;
}

/** ジャンルのアイコンを色つきの丸に載せたバッジ(名前は隣に別途出す)。 */
export function GenreBadge({ name, size = 32 }: { name: string | null; size?: number }) {
  const color = genreColorVar(name);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      <GenreIcon name={name} size={Math.round(size * 0.55)} />
    </span>
  );
}
