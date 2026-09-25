import { describe, expect, it } from 'vitest';
import {
  aisleRow,
  aisleSpot,
  allSeats,
  cartBlocks,
  cartCell,
  distance,
  isAisleSeat,
  isSeatInCabin,
  lavatoryCells,
  parsePlace,
  parseSeat,
  rowSeats,
  seatDistance,
  seatId,
  seatOrder,
  seatsWithin,
} from './grid';
import { rowsFor } from './planes';

describe('grid', () => {
  it('sizes the cabin by max passengers', () => {
    expect(rowsFor(4)).toBe(8);
    expect(rowsFor(8)).toBe(8);
    expect(rowsFor(9)).toBe(10);
    expect(rowsFor(12)).toBe(10);
    expect(rowsFor(16)).toBe(12);
  });

  it('round-trips seat ids and has no seat in the aisle', () => {
    expect(parseSeat('12C')).toEqual({ row: 12, col: 2 });
    expect(parseSeat('3D')).toEqual({ row: 3, col: 4 });
    expect(seatId({ row: 7, col: 6 })).toBe('7F');
    expect(() => seatId({ row: 1, col: 3 })).toThrow();
    expect(parseSeat('0A')).toBeNull();
    expect(parseSeat('4G')).toBeNull();
    expect(isSeatInCabin('9A', 8)).toBe(false);
    expect(isSeatInCabin('8F', 8)).toBe(true);
  });

  it('lists six seats per row', () => {
    const seats = allSeats(8);
    expect(seats).toHaveLength(48);
    expect(seats[0]).toBe('1A');
    expect(seats).toContain('8F');
  });

  it('counts diagonals as 1 and the aisle as a cell', () => {
    expect(seatDistance('12B', '13C')).toBe(1);
    expect(seatDistance('12C', '12D')).toBe(2);
    expect(seatDistance('4B', '6A')).toBe(2);
    expect(distance(cartCell(5), parseSeat('4C')!)).toBe(1);
    expect(isAisleSeat('4C')).toBe(true);
    expect(isAisleSeat('4E')).toBe(false);
  });

  it('a seat bomb in B reaches the aisle but not seat D', () => {
    const hit = seatsWithin([parseSeat('6B')!], 2, 12);
    expect(hit).toContain('4A');
    expect(hit).toContain('8C');
    expect(hit).not.toContain('6D');
    expect(hit).not.toContain('3B');
    expect(hit).toHaveLength(15);
  });

  it('a cart bomb reaches both sides of the aisle', () => {
    const hit = seatsWithin([cartCell(5)], 2, 12);
    expect(hit).toContain('5B');
    expect(hit).toContain('7E');
    expect(hit).not.toContain('5A');
    expect(hit).not.toContain('5F');
    expect(hit).toHaveLength(20);
  });

  it('only the last row A-C is next to the lavatory', () => {
    expect(seatsWithin(lavatoryCells(8), 1, 8).sort()).toEqual(['8A', '8B', '8C']);
    expect(seatsWithin(lavatoryCells(8), 2, 8)).toHaveLength(8);
  });

  it('names aisle spots, which are places but never seats', () => {
    expect(aisleSpot(5)).toBe('Aisle 5');
    expect(aisleRow('Aisle 12')).toBe(12);
    expect(aisleRow('5C')).toBeNull();
    expect(aisleRow(null)).toBeNull();
    expect(parsePlace('Aisle 5')).toEqual(cartCell(5));
    expect(parsePlace('5C')).toEqual({ row: 5, col: 2 });
    expect(parseSeat('Aisle 5')).toBeNull();
    expect(isSeatInCabin('Aisle 5', 8)).toBe(false);
    expect(allSeats(8)).not.toContain('Aisle 5');
    expect(seatOrder('5C')).toBeLessThan(seatOrder('Aisle 5'));
    expect(seatOrder('Aisle 5')).toBeLessThan(seatOrder('5D'));
  });

  it('splits a row into its left and right seats', () => {
    expect(rowSeats(4, 'left')).toEqual(['4A', '4B', '4C']);
    expect(rowSeats(4, 'right')).toEqual(['4D', '4E', '4F']);
    expect(rowSeats(4)).toHaveLength(6);
  });

  it('nobody walks past the drink cart', () => {
    expect(cartBlocks(2, 7, 5)).toBe(true);
    expect(cartBlocks(7, 2, 5)).toBe(true);
    expect(cartBlocks(2, 5, 5)).toBe(false);
    expect(cartBlocks(5, 8, 5)).toBe(false);
    expect(cartBlocks(6, 8, 5)).toBe(false);
    expect(cartBlocks(5, 5, 5)).toBe(false);
  });
});
