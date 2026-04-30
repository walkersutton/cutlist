export interface LinearStock {
	id: string;
	length: number;
	quantity: number; // 0 = unlimited
}

export interface LinearPiece {
	id: string;
	label: string;
	length: number;
	quantity: number;
}

export interface LinearPlacement {
	pieceId: string;
	label: string;
	start: number;
	length: number;
}

export interface LinearBoard {
	index: number;
	stockLength: number;
	placements: LinearPlacement[];
	usedLength: number;
}

export interface UnplacedPiece {
	piece: LinearPiece;
	reason: 'too_large' | 'stock_exhausted';
}

export interface LinearPackResult {
	boards: LinearBoard[];
	unplaced: UnplacedPiece[];
}

export function packLinear(
	stocks: LinearStock[],
	pieces: LinearPiece[],
	kerf = 0
): LinearPackResult {
	const validStocks = stocks.filter((s) => s.length > 0);
	if (!validStocks.length || !pieces.length) return { boards: [], unplaced: [] };

	const allPieces: LinearPiece[] = [];
	for (const piece of pieces) {
		if (piece.length > 0 && piece.quantity > 0) {
			for (let q = 0; q < piece.quantity; q++) allPieces.push(piece);
		}
	}
	if (!allPieces.length) return { boards: [], unplaced: [] };
	allPieces.sort((a, b) => b.length - a.length);

	const remaining = new Map<string, number>(
		validStocks.map((s) => [s.id, s.quantity === 0 ? Infinity : s.quantity])
	);

	interface OpenBoard {
		stock: LinearStock;
		placements: LinearPlacement[];
		usedLength: number;
	}

	const openBoards: OpenBoard[] = [];
	const unplaced: UnplacedPiece[] = [];

	function fitsInAnyStock(pieceLength: number): boolean {
		return validStocks.some((s) => s.length >= pieceLength);
	}

	function chooseBestStock(pieceLength: number): LinearStock | null {
		let best: { stock: LinearStock; length: number } | null = null;
		for (const stock of validStocks) {
			if ((remaining.get(stock.id) ?? 0) <= 0) continue;
			if (stock.length >= pieceLength) {
				if (!best || stock.length < best.length) best = { stock, length: stock.length };
			}
		}
		return best?.stock ?? null;
	}

	for (const piece of allPieces) {
		const needed = piece.length + kerf;

		// Best-fit: board with smallest remaining space that still fits
		let bestBoard: OpenBoard | null = null;
		let bestRemaining = Infinity;
		for (const board of openBoards) {
			const rem = board.stock.length - board.usedLength;
			if (rem >= piece.length && rem < bestRemaining) {
				bestBoard = board;
				bestRemaining = rem;
			}
		}

		if (bestBoard) {
			bestBoard.placements.push({
				pieceId: piece.id,
				label: piece.label,
				start: bestBoard.usedLength,
				length: piece.length
			});
			bestBoard.usedLength += needed;
			continue;
		}

		const stock = chooseBestStock(piece.length);
		if (!stock) {
			unplaced.push({
				piece,
				reason: fitsInAnyStock(piece.length) ? 'stock_exhausted' : 'too_large'
			});
			continue;
		}

		remaining.set(stock.id, (remaining.get(stock.id) ?? 0) - 1);
		const newBoard: OpenBoard = { stock, placements: [], usedLength: 0 };
		openBoards.push(newBoard);

		newBoard.placements.push({
			pieceId: piece.id,
			label: piece.label,
			start: 0,
			length: piece.length
		});
		newBoard.usedLength = needed;
	}

	const boards = openBoards.map((board, index) => ({
		index,
		stockLength: board.stock.length,
		placements: board.placements,
		usedLength: board.usedLength
	}));
	return { boards, unplaced };
}
