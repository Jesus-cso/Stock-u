const bcrypt = require("bcrypt");

const passwordEnTexto = "pollofrito"; // la contraseña que quieras usar para probar

bcrypt.hash(passwordEnTexto, 10).then(hash => {
    console.log("Copia este hash:");
    console.log(hash);
});