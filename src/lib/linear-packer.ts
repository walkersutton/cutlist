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

export function packLinear(stocks: LinearStock[], pieces: LinearPiece[], kerf = 0): LinearBoard[] {
	const validStocks = stocks.filter((s) => s.length > 0);
	if (!validStocks.length || !pieces.length) return [];

	const allPieces: LinearPiece[] = [];
	for (const piece of pieces) {
		if (piece.length > 0 && piece.quantity > 0) {
			for (let q = 0; q < piece.quantity; q++) allPieces.push(piece);
		}
	}
	if (!allPieces.length) return [];
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

	function chooseBestStock(pieceLength: number): LinearStock | null {
		let best: { stock: LinearStock; length: number } | null = null;
		for (const stock of validStocks) {
			if ((remaining.get(stock.id) ?? 0) <= 0) continue;
			if (stock.length >= pieceLength + kerf) {
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
			if (rem >= needed && rem < bestRemaining) {
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
		if (!stock) continue;

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

	return openBoards.map((board, index) => ({
		index,
		stockLength: board.stock.length,
		placements: board.placements,
		usedLength: board.usedLength
	}));
}
