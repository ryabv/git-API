var gulp = require('gulp'),
	watch = require('gulp-watch'),
	browserSync = require('browser-sync').create();

gulp.task('server', function() {
	browserSync.init({
		port: 8080,
        server: ""
    });

    gulp.watch('./img/*').on('change', browserSync.reload);
    gulp.watch('./*.html').on('change', browserSync.reload);
    gulp.watch('./*.css').on('change', browserSync.reload);
});