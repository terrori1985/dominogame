// Конфигурация игры
const GAME_CONFIG = {
    version: '1.0.0',
    stoneTypes: {
        classic: { name: 'Классические', maxValue: 6, totalStones: 28 },
        double: { name: 'Удвоенные', maxValue: 6, totalStones: 7 },
        extended: { name: 'Расширенные', maxValue: 9, totalStones: 55 },
        max: { name: 'Максимальные', maxValue: 12, totalStones: 91 }
    },
    tableThemes: {
        green: 'Классический зелёный',
        wood: 'Деревянный стол',
        dark: 'Тёмная тема',
        marble: 'Мраморный стол'
    },
    botDifficulties: {
        easy: 'Лёгкая',
        medium: 'Средняя',
        hard: 'Сложная'
    }
};