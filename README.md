# Polyfill для промиса

При проверке необходимо использовать new Prom вместо new Promise.

Полифилл запустится только на старых версиях языка без поддержки промисов, так как в начале IIFE стоит проверка. Для проверки на современной версии достаточно закомментировать условие в начале и раскомментировать 12-ю строчку.

Внизу файла добавлен тестовый промис.