// Dados de demonstração: usados enquanto o Supabase não está conectado,
// para que dê para testar todas as telas.

import { newId } from '../lib/id'
import type { Category, Database, Material, Product, RecipeItem, User } from '../types'

export const DB_VERSION = 1

/** Banco vazio (usado no modo nuvem até os dados chegarem). */
export function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    establishment: {
      id: '', name: 'RKFood', slogan: '', logoUrl: null, coverUrl: null, brandColor: '#cf3f17',
      paymentTiming: 'depois', phone: '', address: '', pixKey: '', kitchenTargetMin: 15, tableCount: 10, quickNotes: [],
    },
    users: [], categories: [], products: [], orders: [], payments: [], customers: [], settlements: [], audit: [],
    materials: [], recipes: [], devices: [], cashSessions: [],
  }
}

export function seedDatabase(): Database {
  const cat = (name: string, sort: number): Category => ({ id: newId(), name, sort, deletedAt: null })
  const espetos = cat('Espetinhos', 1)
  const acomp = cat('Acompanhamentos', 2)
  const bebidas = cat('Bebidas', 3)

  const prod = (c: Category, name: string, price: number, description = '', sendToKitchen = true): Product => ({
    id: newId(), categoryId: c.id, name, description, price, photoUrl: null, active: true, sendToKitchen, deletedAt: null,
  })

  const user = (name: string, pin: string, roles: User['roles']): User => ({ id: newId(), name, pin, roles, deletedAt: null, phone: '', createdBy: null, blockedAt: null })

  const products = [
    prod(espetos, 'Carne', 1000, 'Alcatra temperada'),
    prod(espetos, 'Frango', 800, 'Peito de frango com bacon'),
    prod(espetos, 'Linguiça', 800, 'Linguiça toscana'),
    prod(espetos, 'Coração', 900, 'Coração de frango'),
    prod(espetos, 'Queijo coalho', 900, 'Com melaço opcional'),
    prod(espetos, 'Kafta', 1000, 'Carne moída temperada'),
    prod(acomp, 'Farofa', 400),
    prod(acomp, 'Vinagrete', 400),
    prod(acomp, 'Pão de alho', 600),
    prod(bebidas, 'Refrigerante lata', 600, '', false),
    prod(bebidas, 'Água mineral', 400, '', false),
    prod(bebidas, 'Cerveja lata', 700, '', false),
  ]

  // Materiais e fichas técnicas de exemplo (custos aproximados, só para demonstração).
  const mat = (name: string, unit: Material['unit'], cost: number): Material => ({ id: newId(), name, unit, cost, deletedAt: null })
  const materials = [
    mat('Alcatra', 'kg', 4800), mat('Peito de frango', 'kg', 2200), mat('Bacon', 'kg', 3600),
    mat('Linguiça toscana', 'kg', 2600), mat('Coração de frango', 'kg', 3000), mat('Queijo coalho', 'kg', 4200),
    mat('Carne moída', 'kg', 3400), mat('Farinha de mandioca', 'kg', 900), mat('Tomate', 'kg', 700),
    mat('Pão de alho (pacote)', 'un', 1400), mat('Palito de churrasco', 'un', 5), mat('Carvão', 'kg', 600),
    mat('Refrigerante lata', 'un', 280), mat('Água mineral', 'un', 120), mat('Cerveja lata', 'un', 350),
  ]
  const m = (name: string) => materials.find((x) => x.name === name)!.id
  const ficha = (product: string, items: [string, number][]): RecipeItem[] =>
    items.map(([material, qty]) => ({ productId: products.find((x) => x.name === product)!.id, materialId: m(material), qty }))
  const espeto = (carne: [string, number][]): [string, number][] => [...carne, ['Palito de churrasco', 1], ['Carvão', 0.05]]
  const recipes = [
    ...ficha('Carne', espeto([['Alcatra', 0.12]])),
    ...ficha('Frango', espeto([['Peito de frango', 0.1], ['Bacon', 0.03]])),
    ...ficha('Linguiça', espeto([['Linguiça toscana', 0.12]])),
    ...ficha('Coração', espeto([['Coração de frango', 0.1]])),
    ...ficha('Queijo coalho', espeto([['Queijo coalho', 0.08]])),
    ...ficha('Kafta', espeto([['Carne moída', 0.12]])),
    ...ficha('Farofa', [['Farinha de mandioca', 0.08]]),
    ...ficha('Vinagrete', [['Tomate', 0.1]]),
    ...ficha('Pão de alho', [['Pão de alho (pacote)', 0.2], ['Carvão', 0.03]]),
    ...ficha('Refrigerante lata', [['Refrigerante lata', 1]]),
    ...ficha('Água mineral', [['Água mineral', 1]]),
    ...ficha('Cerveja lata', [['Cerveja lata', 1]]),
  ]

  return {
    version: DB_VERSION,
    establishment: {
      id: newId(),
      name: 'Espetinho do Bairro',
      slogan: 'O melhor espetinho da cidade',
      logoUrl: null,
      coverUrl: null,
      brandColor: '#cf3f17',
      paymentTiming: 'depois',
      phone: '',
      address: '',
      pixKey: '',
      kitchenTargetMin: 15, tableCount: 10, quickNotes: [],
    },
    users: [
      user('Dono', '1234', ['dono', 'gerente', 'caixa', 'atendente', 'cozinha']),
      user('Gerente', '5555', ['gerente']),
      user('Ana (atendente)', '1111', ['atendente']),
      user('Cozinha', '2222', ['cozinha']),
      user('Caixa', '3333', ['caixa']),
    ],
    categories: [espetos, acomp, bebidas],
    products,
    orders: [],
    payments: [],
    customers: [
      { id: newId(), name: 'Seu João', phone: '81999990000', notes: 'Vizinho da banca', creditLimit: 10000, deletedAt: null },
    ],
    settlements: [],
    audit: [],
    materials,
    recipes,
    devices: [],
    cashSessions: [],
  }
}
