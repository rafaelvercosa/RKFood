// Dados de demonstração: usados enquanto o Supabase não está conectado,
// para que dê para testar todas as telas.

import { newId } from '../lib/id'
import type { Category, Database, Product, User } from '../types'

export const DB_VERSION = 1

/** Banco vazio (usado no modo nuvem até os dados chegarem). */
export function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    establishment: {
      id: '', name: 'RKFood', slogan: '', logoUrl: null, coverUrl: null, brandColor: '#e4572e',
      paymentTiming: 'depois', phone: '', address: '', pixKey: '',
    },
    users: [], categories: [], products: [], orders: [], payments: [], customers: [], settlements: [], audit: [],
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

  const user = (name: string, pin: string, roles: User['roles']): User => ({ id: newId(), name, pin, roles, deletedAt: null })

  return {
    version: DB_VERSION,
    establishment: {
      id: newId(),
      name: 'Espetinho do Bairro',
      slogan: 'O melhor espetinho da cidade',
      logoUrl: null,
      coverUrl: null,
      brandColor: '#e4572e',
      paymentTiming: 'depois',
      phone: '',
      address: '',
      pixKey: '',
    },
    users: [
      user('Dono', '1234', ['gerente', 'caixa', 'atendente', 'cozinha']),
      user('Ana (atendente)', '1111', ['atendente']),
      user('Cozinha', '2222', ['cozinha']),
      user('Caixa', '3333', ['caixa']),
    ],
    categories: [espetos, acomp, bebidas],
    products: [
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
    ],
    orders: [],
    payments: [],
    customers: [
      { id: newId(), name: 'Seu João', phone: '81999990000', notes: 'Vizinho da banca', creditLimit: 10000, deletedAt: null },
    ],
    settlements: [],
    audit: [],
  }
}
