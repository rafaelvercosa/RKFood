// Cardápios modelo para quem está começando. Os preços são só um exemplo: o dono ajusta depois.

export interface ModelItem { name: string; price: number; sendToKitchen?: boolean }
export interface ModelCategory { name: string; items: ModelItem[] }
export interface MenuModel { id: string; title: string; desc: string; icon: string; categories: ModelCategory[] }

export const MENU_MODELS: MenuModel[] = [
  {
    id: 'espetinho', title: 'Espetinho', desc: 'Carnes, acompanhamentos e bebidas', icon: '🍢',
    categories: [
      { name: 'Espetinhos', items: [
        { name: 'Carne', price: 1000 }, { name: 'Frango', price: 800 }, { name: 'Linguiça', price: 800 },
        { name: 'Coração', price: 900 }, { name: 'Queijo coalho', price: 900 }, { name: 'Kafta', price: 1000 },
        { name: 'Medalhão de frango', price: 1000 }, { name: 'Pão de alho', price: 600 },
      ] },
      { name: 'Acompanhamentos', items: [
        { name: 'Farofa', price: 300 }, { name: 'Vinagrete', price: 300 }, { name: 'Mandioca', price: 500 },
      ] },
      { name: 'Bebidas', items: [
        { name: 'Refrigerante lata', price: 600, sendToKitchen: false }, { name: 'Suco', price: 500, sendToKitchen: false },
        { name: 'Água', price: 300, sendToKitchen: false },
      ] },
    ],
  },
  {
    id: 'lanchonete', title: 'Lanchonete', desc: 'Lanches, porções e sucos', icon: '🍔',
    categories: [
      { name: 'Lanches', items: [
        { name: 'X-Burger', price: 1800 }, { name: 'X-Salada', price: 2000 }, { name: 'X-Bacon', price: 2400 }, { name: 'Cachorro-quente', price: 1200 },
      ] },
      { name: 'Porções', items: [
        { name: 'Batata frita', price: 2000 }, { name: 'Frango a passarinho', price: 2800 },
      ] },
      { name: 'Bebidas', items: [
        { name: 'Refrigerante lata', price: 600, sendToKitchen: false }, { name: 'Suco natural', price: 800, sendToKitchen: false },
        { name: 'Água', price: 300, sendToKitchen: false },
      ] },
    ],
  },
]
